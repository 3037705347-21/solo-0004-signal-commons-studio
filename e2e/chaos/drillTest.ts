import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { purgeWorkspace } from "./faults";
import { getScenario, type DrillScenario } from "./scenarios";

/**
 * Directory where per-scenario evidence JSON is persisted. Playwright removes
 * successful test-result attachments, so drill artifacts are written here
 * directly and survive both passes and failures.
 */
const DRILL_ARTIFACT_DIR = path.resolve(process.cwd(), "chaos-report", "artifacts");

/**
 * Drill test wrapper: binds a spec to a catalog scenario, stamps the Playwright
 * annotations used by the chaos reporter, and guarantees storage isolation
 * before and after the run.
 */

interface DrillArgs {
  page: Page;
  context: import("@playwright/test").BrowserContext;
  scenario: DrillScenario;
  /** Attach a named JSON/text artifact to the drill's report section. */
  artifact: (name: string, body: unknown) => Promise<void>;
}

type DrillCallback = (args: DrillArgs) => Promise<void> | void;

export const drillTest = base.extend<object>({
  // Each Playwright test already gets a fresh in-memory browser context; the
  // explicit purge before/after isolates the workspace keys without clearing
  // storage that a drill seeds between its own tabs.
  context: async ({ context }, use) => {
    await use(context);
    // Cleanup runs even on failure or timeouts.
    await purgeWorkspace(context).catch(() => undefined);
  },
});

export function drillCase(id: string, body: DrillCallback): void {
  const scenario = getScenario(id);
  drillTest(
    `[${scenario.id}] ${scenario.title}`,
    {
      annotation: [
        { type: "drillId", description: scenario.id },
        { type: "drillSuite", description: scenario.suite },
        { type: "drillFault", description: scenario.injectedFault },
        { type: "drillGuarantee", description: scenario.guarantee },
        {
          type: "drillBusinessImpact",
          description: scenario.businessImpact,
        },
        { type: "drillSeverity", description: scenario.severity },
      ],
      tag: [`@chaos`, `@${scenario.suite}`, `@${scenario.id}`],
    },
    async ({ page, context }, testInfo) => {
      const scenarioDir = path.join(DRILL_ARTIFACT_DIR, scenario.id);
      fs.mkdirSync(scenarioDir, { recursive: true });
      const artifact = async (name: string, body: unknown) => {
        const value =
          typeof body === "string" ? body : JSON.stringify(body, null, 2);
        const isJson = typeof body !== "string";
        fs.writeFileSync(path.join(scenarioDir, name), value);
        // Also attach to the Playwright run for in-CI trace access.
        await testInfo.attach(name, {
          body: value,
          contentType: isJson ? "application/json" : "text/plain",
        });
      };
      await purgeWorkspace(context).catch(() => undefined);
      await body({ page, context, scenario, artifact });
    },
  );
}

export { expect };
