import fs from "node:fs";
import path from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  DRILL_SCENARIOS,
  DRILL_SUITE_TITLES,
  type DrillSeverity,
  type DrillSuite,
} from "./scenarios";

/**
 * Chaos drill reporter.
 *
 * Writes, into chaos-report/:
 *   - chaos-report.json  machine-readable gate artifact for CI
 *   - chaos-report.md    business-readable failure-stage/impact report
 *
 * Every drill result carries the injected fault, the guarantee under test,
 * the business impact of a regression, and per-attempt error/console
 * attachments so a failed gate localizes the stage without a rerun.
 */

interface DrillResult {
  id: string;
  suite: DrillSuite;
  title: string;
  status: "passed" | "failed" | "flaky" | "skipped";
  severity: DrillSeverity;
  injectedFault: string;
  guarantee: string;
  businessImpact: string;
  durationMs: number;
  retries: number;
  failures: Array<{
    stage: string;
    message: string;
    snippet?: string;
    location?: string;
  }>;
  attachmentNames: string[];
  /** Persisted evidence files under chaos-report/artifacts/<id>/. */
  artifactPaths: string[];
}

const OUTPUT_DIR = "chaos-report";
const SEVERITY_ORDER: Record<DrillSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

function annotation(test: TestCase, type: string): string | undefined {
  return test.annotations.find((entry) => entry.type === type)?.description;
}

function collectTests(suite: Suite, accumulator: TestCase[] = []): TestCase[] {
  for (const child of suite.suites) collectTests(child, accumulator);
  for (const test of suite.tests) accumulator.push(test);
  return accumulator;
}

function failureStage(result: TestResult): string {
  // Playwright reports the call/expect stage on timed-out or failed steps.
  const stages = result.steps
    .filter((step) => step.error)
    .map((step) => step.title);
  if (stages.length) return stages.join(" → ");
  return result.status === "timedOut" ? "drill timeout" : "assertion";
}

function snippetFrom(error: TestResult["errors"][number]): string | undefined {
  const snippet = error.snippet ?? error.stack;
  if (!snippet) return undefined;
  return plain(snippet).split("\n").slice(0, 4).join("\n");
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function plain(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export default class ChaosReporter implements Reporter {
  private config: FullConfig | null = null;
  private startedAt = "";
  private results = new Map<string, DrillResult>();
  private unrecognized: string[] = [];

  onBegin(config: FullConfig, rootSuite: Suite): void {
    this.config = config;
    this.startedAt = new Date().toISOString();
    // Ensure every catalog scenario is represented even if a spec never ran.
    for (const test of collectTests(rootSuite)) {
      const id = annotation(test, "drillId");
      if (!id) {
        this.unrecognized.push(test.title);
        continue;
      }
      const scenario = DRILL_SCENARIOS.find((entry) => entry.id === id);
      if (!scenario) continue;
      this.results.set(id, {
        id,
        suite: scenario.suite,
        title: scenario.title,
        status: "skipped",
        severity: scenario.severity,
        injectedFault: scenario.injectedFault,
        guarantee: scenario.guarantee,
        businessImpact: scenario.businessImpact,
        durationMs: 0,
        retries: 0,
        failures: [],
        attachmentNames: [],
        artifactPaths: [],
      });
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = annotation(test, "drillId");
    if (!id) return;
    const entry = this.results.get(id);
    if (!entry) return;
    const failingStatuses = ["failed", "timedOut", "interrupted"];
    const didFail = failingStatuses.includes(result.status);
    // A drill that passed only after retries is reported flaky (retries are
    // disabled in the gate config, so this only appears in local debugging).
    entry.status = didFail
      ? "failed"
      : result.retry > 0 && test.results.some((prior) => failingStatuses.includes(prior.status))
        ? "flaky"
        : (result.status as DrillResult["status"]);
    entry.durationMs = result.duration;
    entry.retries = result.retry;
    entry.attachmentNames = result.attachments.map(
      (attachment) => attachment.name ?? "attachment",
    );
    const projectRoot = this.config?.configFile
      ? path.dirname(this.config.configFile)
      : process.cwd();
    entry.artifactPaths = fs.existsSync(
      path.resolve(projectRoot, OUTPUT_DIR, "artifacts", id),
    )
      ? fs
          .readdirSync(path.resolve(projectRoot, OUTPUT_DIR, "artifacts", id))
          .map((name) => path.join("artifacts", id, name))
      : [];
    if (didFail) {
      entry.failures = result.errors.map((error) => ({
        stage: failureStage(result),
        message: plain(error.message ?? "Unknown failure"),
        snippet: snippetFrom(error),
        location: error.location
          ? `${error.location.file}:${error.location.line}`
          : undefined,
      }));
    }
  }

  onEnd(result: FullResult): void {
    try {
      // FullConfig.rootDir follows the (chaos-specific) testDir; the project
      // root is the directory containing the resolved config file.
      const projectRoot = this.config?.configFile
        ? path.dirname(this.config.configFile)
        : process.cwd();
      const outputDir = path.resolve(projectRoot, OUTPUT_DIR);
      fs.mkdirSync(outputDir, { recursive: true });

    const scenarios = [...this.results.values()].sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        left.id.localeCompare(right.id),
    );
    const passed = scenarios.filter((entry) => entry.status === "passed")
      .length;
    const failed = scenarios.filter((entry) => entry.status === "failed")
      .length;
    const skipped = scenarios.filter((entry) => entry.status === "skipped")
      .length;
    const gatePassed = failed === 0 && skipped === 0 && result.status === "passed";

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt,
      durationMs: result.duration,
      gatePassed,
      totals: {
        scenarios: scenarios.length,
        passed,
        failed,
        skipped,
      },
      suites: this.suiteSummaries(scenarios),
      scenarios: scenarios.map((entry) => ({
        ...entry,
        gateBlocking:
          entry.status === "failed" && entry.severity === "critical",
      })),
      unrecognizedTests: this.unrecognized,
    };

    fs.writeFileSync(
      path.join(outputDir, "chaos-report.json"),
      JSON.stringify(payload, null, 2),
    );
    fs.writeFileSync(
      path.join(outputDir, "chaos-report.md"),
      this.renderMarkdown(payload),
    );
    } catch (error) {
      // A report failure must not mask test results; Playwright surfaces
      // reporter errors itself, but writing both formats is best-effort.
      process.stderr.write(
        `[chaosReporter] failed to write report: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  private suiteSummaries(scenarios: DrillResult[]) {
    return (Object.keys(DRILL_SUITE_TITLES) as DrillSuite[]).map((suite) => {
      const entries = scenarios.filter((entry) => entry.suite === suite);
      return {
        suite,
        title: DRILL_SUITE_TITLES[suite],
        total: entries.length,
        passed: entries.filter((entry) => entry.status === "passed").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
      };
    });
  }

  private renderMarkdown(payload: {
    generatedAt: string;
    startedAt: string;
    durationMs: number;
    gatePassed: boolean;
    totals: { scenarios: number; passed: number; failed: number; skipped: number };
    suites: Array<{
      suite: string;
      title: string;
      total: number;
      passed: number;
      failed: number;
    }>;
    scenarios: Array<DrillResult & { gateBlocking: boolean }>;
    unrecognizedTests: string[];
  }): string {
    const lines: string[] = [];
    lines.push("# Chaos drill gate report");
    lines.push("");
    lines.push(`- Generated: ${payload.generatedAt}`);
    lines.push(`- Run window: ${payload.startedAt} → ${payload.generatedAt}`);
    lines.push(`- Wall time: ${(payload.durationMs / 1000).toFixed(1)} s`);
    lines.push(
      `- Gate: **${payload.gatePassed ? "PASSED" : "FAILED"}** — ${payload.totals.passed}/${payload.totals.scenarios} scenarios passed, ${payload.totals.failed} failed, ${payload.totals.skipped} skipped`,
    );
    lines.push("");
    lines.push("## Suite coverage");
    for (const suite of payload.suites) {
      lines.push(
        `- **${suite.title}** (${suite.suite}): ${suite.passed}/${suite.total} passed${suite.failed ? `, **${suite.failed} failed**` : ""}`,
      );
    }
    lines.push("");
    lines.push("## Scenario detail");
    for (const entry of payload.scenarios) {
      const icon =
        entry.status === "passed"
          ? "✅"
          : entry.status === "failed"
            ? entry.gateBlocking
              ? "⛔️"
              : "❌"
            : "⏭️";
      lines.push(
        `### ${icon} ${entry.id} — ${entry.title} (${entry.severity})`,
      );
      lines.push("");
      lines.push(`- Suite: ${DRILL_SUITE_TITLES[entry.suite]}`);
      lines.push(`- Status: **${entry.status}**`);
      lines.push(`- Duration: ${entry.durationMs} ms`);
      lines.push(`- Injected fault: ${entry.injectedFault}`);
      lines.push(`- Required guarantee: ${entry.guarantee}`);
      lines.push(
        `- Business impact if broken: **${entry.businessImpact}**`,
      );
      if (entry.artifactPaths.length) {
        lines.push(
          `- Evidence: ${entry.artifactPaths
            .map((artifactPath) => `chaos-report/${artifactPath}`)
            .join(", ")}`,
        );
      }
      if (entry.failures.length) {
        lines.push("- Failures:");
        for (const failure of entry.failures) {
          lines.push(`  - Stage: **${failure.stage}**`);
          lines.push(`    - ${failure.message.replace(/\n/g, " ")}`);
          if (failure.location) lines.push(`    - At: ${failure.location}`);
          if (failure.snippet) {
            lines.push("    - Snippet:");
            lines.push(
              failure.snippet
                .split("\n")
                .map((snippetLine) => `      > ${snippetLine}`)
                .join("\n"),
            );
          }
        }
      }
      lines.push("");
    }
    if (payload.unrecognizedTests.length) {
      lines.push("## Unrecognized tests (missing drill annotations)");
      for (const title of payload.unrecognizedTests) lines.push(`- ${title}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  printsToStdio(): boolean {
    return false;
  }
}
