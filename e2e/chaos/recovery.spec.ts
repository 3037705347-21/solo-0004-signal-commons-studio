import { expect } from "@playwright/test";
import {
  corruptPrimary,
  crashRenderer,
  installStorageOutageSwitch,
  readPersistedStudy,
  readRawWorkspace,
  seedWorkspace,
  setStorageOutage,
  waitForPersistedRevision,
} from "./faults";
import { drillCase } from "./drillTest";
import {
  makeCorruptEnvelope,
  makeDrillStudy,
  makeTruncatedEnvelope,
} from "./fixtures";
import type { StudyState } from "../../src/domain/models";

/** Readiness freezes keep the content revision; wait for the release record. */
async function waitForReadyRelease(
  page: import("@playwright/test").Page,
  revision: number,
  timeoutMs = 5_000,
): Promise<StudyState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readPersistedStudy(page);
    if (state?.revision === revision && state.release?.status === "ready") {
      return state;
    }
    await page.waitForTimeout(25);
  }
  const state = await readPersistedStudy(page);
  throw new Error(
    `Ready release did not freeze at revision ${revision} (status: ${state?.release?.status ?? "none"})`,
  );
}

drillCase("FR-01", async ({ page, context, artifact }) => {
  const baseline = makeDrillStudy({ revision: 4 });
  await page.goto("/library");
  await seedWorkspace(context, baseline);

  // Fresh tab on the seeded baseline, then a committed change.
  const worker = await context.newPage();
  await worker.goto("/library");
  await expect(worker.getByText("Drill signal 1").first()).toBeVisible();
  await worker.getByRole("button", { name: "Add clip" }).first().click();
  await worker.getByLabel("Catalog ID").fill("SC-FR01-001");
  await worker.getByLabel("Title").fill("Crash barrier clip");
  await worker.getByLabel("Recorder / source").fill("Recovery drill");
  await worker.getByLabel("Recording date").fill("2026-08-22");
  await worker.getByLabel("File format").fill("WAV");
  await worker.getByLabel("Location").fill("Crash station");
  await worker
    .getByLabel("Clip summary")
    .fill("Committed immediately before the renderer is killed abruptly.");
  await worker.getByRole("button", { name: "Add clip" }).last().click();
  await waitForPersistedRevision(page, 5);

  // Abrupt kill: no beforeunload, no graceful flush.
  await crashRenderer(worker);

  const reopened = await context.newPage();
  await reopened.goto("/library");
  await expect(
    reopened.getByText("Crash barrier clip").first(),
  ).toBeVisible({ timeout: 5_000 });
  const persisted = await readPersistedStudy(reopened);
  expect(persisted?.revision).toBe(5);
  expect(
    persisted?.recordings.some(
      (recording) => recording.catalogId === "SC-FR01-001",
    ),
  ).toBe(true);

  await artifact("fr-01-recovery.json", {
    killedAfterRevision: 5,
    reopenedRevision: persisted?.revision,
    clipRecovered: true,
  });
  await reopened.close();
});

drillCase("FR-02", async ({ page, context, artifact }) => {
  const backup = makeDrillStudy({
    revision: 9,
    recordingCount: 20,
  });
  const primary = makeDrillStudy({
    revision: 10,
    recordingCount: 21,
  });
  await page.goto("/library");
  await seedWorkspace(context, primary, { backup });

  // Damage the primary while the backup stays intact.
  await corruptPrimary(page, makeCorruptEnvelope(primary));
  const rawBefore = await readRawWorkspace(page);
  expect(rawBefore.primary).toContain('"checksum":"deadbeef"');

  const reopened = await context.newPage();
  await reopened.goto("/library");
  await expect(reopened.getByText("Drill signal 1").first()).toBeVisible();
  const recovered = await readPersistedStudy(reopened);
  expect(recovered?.revision).toBe(9);
  expect(recovered?.recordings).toHaveLength(20);
  // Backup recovery is a known, bounded loss: exactly the last command.
  expect(
    recovered?.recordings.some(
      (recording) => recording.title === "Drill signal 21",
    ),
  ).toBe(false);

  await artifact("fr-02-backup-fallback.json", {
    damagedRevision: 10,
    recoveredRevision: recovered?.revision,
    recoveredRecordings: recovered?.recordings.length,
  });
  await reopened.close();
});

drillCase("FR-03", async ({ page, context, artifact }) => {
  const backup = makeDrillStudy({ revision: 11, recordingCount: 16 });
  const primary = makeDrillStudy({ revision: 12, recordingCount: 17 });
  await page.goto("/library");
  await seedWorkspace(context, primary, { backup });
  await corruptPrimary(page, makeTruncatedEnvelope(primary));

  const reopened = await context.newPage();
  await reopened.goto("/library");
  const recovered = await readPersistedStudy(reopened);
  expect(recovered?.revision).toBe(11);
  expect(recovered?.recordings).toHaveLength(16);
  await expect(
    reopened.getByText(`Drill signal 16`).first(),
  ).toBeVisible();

  await artifact("fr-03-torn-write.json", {
    tornRevision: 12,
    recoveredRevision: recovered?.revision,
  });
  await reopened.close();
});

drillCase("FR-04", async ({ page, context, artifact }) => {
  await page.goto("/library");
  // Purge first, then write garbage into both keys directly.
  await seedWorkspace(context, makeDrillStudy({ revision: 2 }));
  await page.evaluate(
    ([key, backupKey]) => {
      window.localStorage.setItem(key, "{not-json");
      window.localStorage.setItem(backupKey, "[1,2,");
    },
    [
      "signal-commons.workspace.v1",
      "signal-commons.workspace.backup.v1",
    ] as const,
  );

  const reopened = await context.newPage();
  const errors: string[] = [];
  reopened.on("pageerror", (error) => errors.push(error.message));
  await reopened.goto("/library");

  // Degrades to the seed study, not a white screen.
  await expect(
    reopened.getByText("Underpass reverb at dawn").first(),
  ).toBeVisible({ timeout: 5_000 });
  const recovered = await readPersistedStudy(reopened);
  expect(recovered?.revision).toBe(0);
  expect(recovered?.project.title).toBe(
    "Signal Commons: Listening Across the City",
  );
  expect(errors).toEqual([]);

  // And the workspace is immediately writable again.
  await reopened.getByRole("button", { name: "Add clip" }).first().click();
  await reopened.getByLabel("Catalog ID").fill("SC-FR04-001");
  await reopened.getByLabel("Title").fill("Post-corruption clip");
  await reopened.getByLabel("Recorder / source").fill("Recovery drill");
  await reopened.getByLabel("Recording date").fill("2026-08-23");
  await reopened.getByLabel("File format").fill("WAV");
  await reopened.getByLabel("Location").fill("Reset station");
  await reopened
    .getByLabel("Clip summary")
    .fill("First valid commit after both workspace records were corrupted.");
  await reopened.getByRole("button", { name: "Add clip" }).last().click();
  await expect(
    reopened.getByText("Post-corruption clip").first(),
  ).toBeVisible();

  await artifact("fr-04-total-corruption.json", {
    degradedToSeed: true,
    rewriteAccepted: true,
    pageErrors: errors,
  });
  await reopened.close();
});

drillCase("FR-05", async ({ page, context, artifact }) => {
  const study = makeDrillStudy({ revision: 6, placedPerSite: 1 });
  const firstClipId = study.recordings[0].id;
  // Site 1 references a clip that no longer exists, and lists one real clip
  // twice in adjacent positions.
  study.sites[0].recordingIds = [
    "rec-does-not-exist",
    firstClipId,
    firstClipId,
    ...study.sites[0].recordingIds.slice(1),
  ];
  await page.goto("/library");
  await seedWorkspace(context, study, {
    rawOverride: JSON.stringify(study),
  });

  const reopened = await context.newPage();
  await reopened.goto("/route");
  const healed = await readPersistedStudy(reopened);
  const thresholdIds = healed?.sites[0].recordingIds ?? [];
  expect(thresholdIds).not.toContain("rec-does-not-exist");
  expect(thresholdIds.filter((id) => id === firstClipId)).toHaveLength(1);
  // No clip can appear in two sites after reference validation.
  const allPlacements = (healed?.sites ?? []).flatMap(
    (site) => site.recordingIds,
  );
  expect(new Set(allPlacements).size).toBe(allPlacements.length);

  await artifact("fr-05-reference-repair.json", {
    before: ["rec-does-not-exist", firstClipId, firstClipId],
    after: thresholdIds,
  });
  await reopened.close();
});

drillCase("FR-06", async ({ page, context, artifact }) => {
  // Baseline where the route already carries all four roles and featured
  // clips, with no findings: a readiness run must freeze a ready release.
  const study = makeDrillStudy({
    revision: 14,
    recordingCount: 8,
    placedPerSite: 2,
    issueCount: 0,
  });
  await page.goto("/library");
  await seedWorkspace(context, study);

  const worker = await context.newPage();
  await worker.goto("/quality");
  await worker.getByRole("button", { name: "Run readiness check" }).click();
  await expect(worker.getByText("Ready to share").first()).toBeVisible({
    timeout: 5_000,
  });
  // A readiness freeze keeps the same content revision; poll for the release.
  const frozen = await waitForReadyRelease(worker, 14);
  expect(frozen.release?.status).toBe("ready");
  const { id: releaseId, sequence, fingerprint } = frozen.release as NonNullable<
    typeof frozen.release
  >;

  // Kill immediately after the freeze, then reopen cold.
  await crashRenderer(worker);
  const reopened = await context.newPage();
  await reopened.goto("/quality");
  await expect(reopened.getByText("Ready to share").first()).toBeVisible({
    timeout: 5_000,
  });
  const restored = await readPersistedStudy(reopened);
  expect(restored?.release?.status).toBe("ready");
  expect(restored?.release?.id).toBe(releaseId);
  expect(restored?.release?.sequence).toBe(sequence);
  expect(restored?.release?.fingerprint).toBe(fingerprint);
  await expect(
    reopened.getByRole("button", { name: "Export snapshot" }),
  ).toBeVisible();

  await artifact("fr-06-release-survival.json", {
    releaseId,
    sequence,
    fingerprint,
    survivedCrash: true,
  });
  await reopened.close();
});

drillCase("FR-07", async ({ page, context, artifact }) => {
  const baseline = makeDrillStudy({ revision: 13 });
  await installStorageOutageSwitch(context);
  await page.goto("/library");
  await seedWorkspace(context, baseline);
  await page.reload();
  await expect(page.getByText("Drill signal 1").first()).toBeVisible();

  const committedBefore = await readPersistedStudy(page);
  expect(committedBefore?.revision).toBe(13);

  // Throw the outage, then attempt a write through the UI.
  await setStorageOutage(page, true);
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-FR07-001");
  await page.getByLabel("Title").fill("Outage window clip");
  await page.getByLabel("Recorder / source").fill("Recovery drill");
  await page.getByLabel("Recording date").fill("2026-08-24");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Outage station");
  await page
    .getByLabel("Clip summary")
    .fill("An edit attempted while every storage write is failing.");
  await page.getByRole("button", { name: "Add clip" }).last().click();

  // The degraded state must be explicit in the shell.
  await expect(page.getByText("Local save unavailable")).toBeVisible({
    timeout: 5_000,
  });

  // The last committed record on disk is untouched by the failed write.
  const rawDuring = await readRawWorkspace(page);
  const primaryDuringOutage = rawDuring.primary ?? "";
  expect(primaryDuringOutage).toContain("Drill signal 1");
  expect(primaryDuringOutage).not.toContain("Outage window clip");
  const diskDuring = await readPersistedStudy(page);
  expect(diskDuring?.revision).toBe(13);

  // Restore the quota. The next write lands and the healthy indicator returns.
  await setStorageOutage(page, false);
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-FR07-002");
  await page.getByLabel("Title").fill("Recovery window clip");
  await page.getByLabel("Recorder / source").fill("Recovery drill");
  await page.getByLabel("Recording date").fill("2026-08-25");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Recovery station");
  await page
    .getByLabel("Clip summary")
    .fill("The first write after the storage outage was cleared.");
  await page.getByRole("button", { name: "Add clip" }).last().click();

  const recovered = await waitForPersistedRevision(page, 14);
  expect(
    recovered.recordings.some(
      (recording) => recording.title === "Recovery window clip",
    ),
  ).toBe(true);
  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Local save unavailable")).toHaveCount(0);

  await artifact("fr-07-storage-outage.json", {
    committedRevisionDuringOutage: diskDuring?.revision,
    diskUntouched: !primaryDuringOutage.includes("Outage window clip"),
    recoveredRevision: recovered.revision,
  });
});
