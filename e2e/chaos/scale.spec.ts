import { expect, type Page } from "@playwright/test";
import { seedWorkspace } from "./faults";
import { drillCase } from "./drillTest";
import { makeDrillStudy } from "./fixtures";

/**
 * Scale drills seed deterministic large workspaces directly into storage,
 * bypassing the UI for data creation (which is not the system under test)
 * and using the UI only for the interactions that must stay usable.
 */

const LARGE_RECORDING_COUNT = 1200;
const LARGE_ISSUE_COUNT = 150;

async function seededPage(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  options: Parameters<typeof makeDrillStudy>[0],
): Promise<void> {
  await page.goto("/library");
  await seedWorkspace(context, makeDrillStudy(options));
  await page.reload();
}

drillCase("LD-01", async ({ page, context, artifact }) => {
  await seededPage(page, context, {
    revision: 21,
    recordingCount: LARGE_RECORDING_COUNT,
    placedPerSite: 8,
    issueCount: LARGE_ISSUE_COUNT,
  });

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const start = Date.now();
  await page.goto("/library");
  await expect(
    page.getByText("Drill signal 1").first(),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const interactiveMs = Date.now() - start;

  await expect(
    page.getByText(`${LARGE_RECORDING_COUNT}`).first(),
  ).toBeVisible();

  // Search narrows 1,200 clips to the exact matching set. Catalog IDs are
  // zero-padded, so "SC-DRILL-0501" matches exactly one recording.
  await page
    .getByPlaceholder("Search title, source, ID, or tag")
    .fill("SC-DRILL-0501");
  await expect(page.getByText("Drill signal 501").first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Drill signal 500")).toHaveCount(0);

  // Clear and switch views: the other heavy surfaces must also mount.
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.goto("/route");
  await expect(page.getByText("Clip queue").first()).toBeVisible({
    timeout: 10_000,
  });
  await page.goto("/quality");
  await expect(page.getByText("Run readiness check").first()).toBeVisible({
    timeout: 10_000,
  });

  expect(errors).toEqual([]);
  await artifact("ld-01-large-library.json", {
    recordings: LARGE_RECORDING_COUNT,
    findings: LARGE_ISSUE_COUNT,
    interactiveMs,
    pageErrors: errors,
  });
});

drillCase("LD-02", async ({ page, context, artifact }) => {
  // 40 clips: 8 already placed (2 per site), 32 in the queue. The first site
  // is enlarged so every queue placement can target it without tripping
  // capacity; this drills bulk recalculation, not the capacity guard.
  const study = makeDrillStudy({
    revision: 31,
    recordingCount: 40,
    placedPerSite: 2,
  });
  study.sites[0] = {
    ...study.sites[0],
    maxClips: 40,
    maxDurationSeconds: 20_000,
  };
  await page.goto("/library");
  await seedWorkspace(context, study);
  await page.goto("/route");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const start = Date.now();
  const placements = 20;
  for (let index = 0; index < placements; index += 1) {
    // Queue order follows recordings order; recordings 9+ are unplaced.
    const sequence = index + 9;
    const title = `Drill signal ${sequence}`;
    await page
      .getByRole("button", { name: new RegExp(title, "i") })
      .first()
      .click();
    // The selected recording exposes a place button on every site lane; the
    // first lane is the enlarged first site.
    await page
      .getByRole("button", { name: new RegExp(`Place ${title} here`, "i") })
      .first()
      .click();
    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 5_000,
    });
  }
  const bulkMs = Date.now() - start;

  const persisted = await page.evaluate(
    ([key]) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as { stateJson: string };
      return JSON.parse(envelope.stateJson) as {
        revision: number;
        sites: Array<{ recordingIds: string[] }>;
        recordings: unknown[];
      };
    },
    ["signal-commons.workspace.v1"] as const,
  );
  const placedTotal =
    persisted?.sites.reduce(
      (sum, site) => sum + site.recordingIds.length,
      0,
    ) ?? 0;
  expect(placedTotal).toBe(8 + placements);
  expect(persisted?.revision).toBe(31 + placements);
  expect(errors).toEqual([]);
  await expect(page.getByText(/supports up to/)).toHaveCount(0);

  await artifact("ld-02-bulk-placement.json", {
    placements,
    placedTotal,
    bulkMs,
    finalRevision: persisted?.revision,
    pageErrors: errors,
  });
});

drillCase("LD-03", async ({ page, context, artifact }) => {
  // All featured clips placed, every signal role present, no critical issues:
  // the release engine must return a deterministic "ready" verdict at scale.
  await seededPage(page, context, {
    revision: 41,
    recordingCount: LARGE_RECORDING_COUNT,
    placedPerSite: 8,
    issueCount: LARGE_ISSUE_COUNT,
  });

  const runReadiness = async (): Promise<{
    score: string;
    heading: string;
    blockers: string[];
  }> => {
    await page.goto("/quality");
    await page.getByRole("button", { name: "Run readiness check" }).click();
    const heading = page.locator(".readiness-card h2").first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const headingText = (await heading.textContent()) ?? "";
    const score =
      (await page.locator(".readiness-score strong").first().textContent()) ??
      "";
    const blockers = await page
      .locator(".blocker-row span")
      .allTextContents();
    return { score: score.trim(), heading: headingText.trim(), blockers };
  };

  const first = await runReadiness();
  expect(first.heading).toBe("Ready to share");

  // Independent cold rerun: fresh component tree on the same persisted state.
  await page.reload();
  const second = await runReadiness();

  expect(second.heading).toBe(first.heading);
  expect(second.score).toBe(first.score);
  expect(second.blockers).toEqual(first.blockers);

  await artifact("ld-03-readiness-at-scale.json", {
    recordings: LARGE_RECORDING_COUNT,
    findings: LARGE_ISSUE_COUNT,
    first,
    second,
    deterministic:
      JSON.stringify(first) === JSON.stringify(second),
  });
});
