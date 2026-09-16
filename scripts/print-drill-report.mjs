#!/usr/bin/env node
/**
 * Print the latest chaos drill gate report to the terminal.
 * Reads chaos-report/chaos-report.json produced by the custom reporter.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, "chaos-report", "chaos-report.json");

if (!fs.existsSync(reportPath)) {
  console.error(
    "No chaos report found. Run `npm run drill` (or `npm run drill:one -- <id>`) first.",
  );
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const icon = { passed: "✅", failed: "⛔️", flaky: "⚠️ ", skipped: "⏭️" };
console.log("");
console.log("Chaos drill gate");
console.log("=".repeat(60));
console.log(
  `Gate ${report.gatePassed ? "PASSED" : "FAILED"}  ·  ${report.totals.passed}/${report.totals.scenarios} passed  ·  ${(report.durationMs / 1000).toFixed(1)}s`,
);
for (const suite of report.suites) {
  console.log(
    `  ${suite.title}: ${suite.passed}/${suite.total} passed${suite.failed ? ` (${suite.failed} FAILED)` : ""}`,
  );
}
console.log("-".repeat(60));
for (const scenario of report.scenarios) {
  const marker =
    scenario.status === "failed"
      ? scenario.gateBlocking
        ? icon.failed
        : "❌"
      : icon[scenario.status] ?? "•";
  console.log(`${marker} ${scenario.id} [${scenario.severity}] ${scenario.title}`);
  if (scenario.status === "failed") {
    for (const failure of scenario.failures) {
      console.log(`     stage: ${failure.stage}`);
      console.log(
        `     ${failure.message.split("\n")[0].slice(0, 140)}`,
      );
      if (failure.location) console.log(`     at ${failure.location}`);
    }
    console.log(`     business impact: ${scenario.businessImpact}`);
  }
}
console.log("-".repeat(60));
console.log("Full report: chaos-report/chaos-report.md");
console.log("");

process.exit(report.gatePassed ? 0 : 1);
