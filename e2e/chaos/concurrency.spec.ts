import { expect } from "@playwright/test";
import {
  addRecordingViaUi,
  fillRecordingForm,
  submitRecordingFormUnchecked,
  waitForPersistedRevision,
} from "./faults";
import { drillCase } from "./drillTest";
import { makeDrillStudy } from "./fixtures";

/**
 * Concurrency drills operate multiple tabs in one isolated browser context.
 * Barrier steps ("fence") make interleaving deterministic: every tab is at
 * exactly the same form state before any tab commits.
 */

async function openTabOnLibrary(
  context: import("@playwright/test").BrowserContext,
): Promise<import("@playwright/test").Page> {
  const page = await context.newPage();
  await page.goto("/library");
  await page
    .getByRole("button", { name: "Add clip" })
    .first()
    .waitFor({ state: "visible" });
  return page;
}

async function fillNewClipForm(
  page: import("@playwright/test").Page,
  sequence: number,
): Promise<void> {
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill(`SC-CC01-${String(sequence).padStart(3, "0")}`);
  await page.getByLabel("Title").fill(`Barrier commit ${sequence}`);
  await page.getByLabel("Recorder / source").fill("Drill concurrency team");
  await page.getByLabel("Recording date").fill("2026-08-21");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill(`Barrier station ${sequence}`);
  await page
    .getByLabel("Clip summary")
    .fill(
      `Deterministic barrier commit number ${sequence} used for cross-tab convergence.`,
    );
}

async function submitClipForm(
  page: import("@playwright/test").Page,
  sequence: number,
): Promise<void> {
  await page.getByRole("button", { name: "Add clip" }).last().click();
  await expect(
    page.getByText(`Barrier commit ${sequence}`).first(),
  ).toBeVisible({ timeout: 5_000 });
}

drillCase("CC-01", async ({ page, context, artifact }) => {
  const baseline = makeDrillStudy({
    recordingCount: 8,
    placedPerSite: 1,
    revision: 5,
  });
  await page.goto("/library");
  await page.evaluate(
    ([key, raw]) => window.localStorage.setItem(key, raw),
    ["signal-commons.workspace.v1", JSON.stringify(baseline)] as const,
  );
  await page.reload();
  await expect(page.getByText("Drill signal 1").first()).toBeVisible();

  const tabCount = 4;
  const tabs = await Promise.all(
    Array.from({ length: tabCount }, () => openTabOnLibrary(context)),
  );

  // Fence 1: every tab has the editor open with its own distinct draft.
  await Promise.all(
    tabs.map((tab, index) => fillNewClipForm(tab, index + 1)),
  );

  // Fence 2: commits are released one at a time. Because each tab receives
  // the prior tab's storage event (and heals its revision guard) before it
  // commits, the sequence must produce exactly N chained revisions.
  for (let index = 0; index < tabs.length; index += 1) {
    await submitClipForm(tabs[index], index + 1);
    await waitForPersistedRevision(page, 5 + index + 1);
  }

  const persisted = await waitForPersistedRevision(page, 5 + tabCount);
  expect(persisted.recordings).toHaveLength(8 + tabCount);
  for (let index = 1; index <= tabCount; index += 1) {
    expect(
      persisted.recordings.some(
        (recording) => recording.title === `Barrier commit ${index}`,
      ),
    ).toBe(true);
  }

  // Every still-open tab must converge on the same winning library.
  await tabs[tabs.length - 1].bringToFront();
  for (let index = 1; index <= tabCount; index += 1) {
    await expect(
      tabs[index % tabs.length]
        .getByText(`Barrier commit ${index}`)
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  }

  // Reload proves the record is complete, not just in-memory.
  await page.reload();
  for (let index = 1; index <= tabCount; index += 1) {
    await expect(
      page.getByText(`Barrier commit ${index}`).first(),
    ).toBeVisible();
  }
  await artifact("cc-01-final-state.json", {
    revision: persisted.revision,
    recordingCount: persisted.recordings.length,
    catalogIds: persisted.recordings
      .map((recording) => recording.catalogId)
      .filter((id) => id.startsWith("SC-CC01")),
  });

  await Promise.all(tabs.map((tab) => tab.close()));
});

drillCase("CC-02", async ({ page, context, artifact }) => {
  const baseline = makeDrillStudy({ revision: 7 });
  await page.goto("/library");
  await page.evaluate(
    ([key, raw]) => window.localStorage.setItem(key, raw),
    ["signal-commons.workspace.v1", JSON.stringify(baseline)] as const,
  );

  // Install a storage-event gate on the stale tab BEFORE it loads the app:
  // cross-tab commits are captured and held, so the app's own listener never
  // advances the stale tab's revision. We cannot rely on event-propagation
  // stop calls (listeners live on independent registration slots), so the
  // gate wraps addEventListener for "storage" and filters at dispatch time.
  const staleTab = await context.newPage();
  await staleTab.addInitScript(() => {
    const w = window as Window & {
      __drillLocked?: boolean;
      __drillQueuedEvents?: Event[];
      __drillReleaseEvents?: () => void;
    };
    w.__drillLocked = true;
    w.__drillQueuedEvents = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function gatedAddEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ) {
      if (type === "storage" && listener) {
        const wrapped: EventListener = (event) => {
          if (
            (event as StorageEvent).key ===
              "signal-commons.workspace.v1" &&
            w.__drillLocked
          ) {
            w.__drillQueuedEvents?.push(event);
            return;
          }
          if (typeof listener === "function") listener.call(this, event);
          else listener.handleEvent(event);
        };
        return originalAdd.call(this, type, wrapped, options);
      }
      return originalAdd.call(this, type, listener, options);
    };
    w.__drillReleaseEvents = () => {
      const queued = w.__drillQueuedEvents ?? [];
      w.__drillLocked = false;
      w.__drillQueuedEvents = [];
      queued.forEach((event) =>
        w.dispatchEvent(
          new StorageEvent("storage", event as StorageEventInit),
        ),
      );
    };
  });
  await staleTab.goto("/library");
  await expect(staleTab.getByText("Drill signal 1").first()).toBeVisible();

  // Winner tab commits normally; the stale tab's capture-phase gate holds the
  // event so its revision guard never advances.
  const winnerTab = await context.newPage();
  await winnerTab.goto("/library");
  await addRecordingViaUi(winnerTab, 1);
  const winning = await waitForPersistedRevision(page, 8);
  expect(
    winning.recordings.some((recording) => recording.title === "Concurrent signal 1"),
  ).toBe(true);

  // The stale tab stays on the page it loaded before rev 8 existed: any
  // navigation would resync directly from disk and defeat the scenario.
  await fillRecordingForm(staleTab, 2);
  await submitRecordingFormUnchecked(staleTab);
  // Give the provider effect time to attempt the refused commit and heal.
  await page.waitForTimeout(600);

  const afterStale = await waitForPersistedRevision(page, 8);
  expect(afterStale.revision).toBe(8);
  expect(
    afterStale.recordings.some(
      (recording) => recording.title === "Concurrent signal 2",
    ),
  ).toBe(false);
  expect(
    afterStale.recordings.some(
      (recording) => recording.title === "Concurrent signal 1",
    ),
  ).toBe(true);

  // Release the queued events: the stale tab heals to the winner instead of
  // surfacing its refused branch or a save failure.
  await staleTab.evaluate(() => {
    (
      window as Window & { __drillReleaseEvents?: () => void }
    ).__drillReleaseEvents?.();
  });
  await expect(
    staleTab.getByText("Concurrent signal 1").first(),
  ).toBeVisible({ timeout: 5_000 });
  await expect(staleTab.getByText("Local save unavailable")).toHaveCount(0);

  await artifact("cc-02-revision-trace.json", {
    baselineRevision: 7,
    winningRevision: 8,
    staleCommitRefused: true,
    finalRevision: afterStale.revision,
  });

  await Promise.all([winnerTab.close(), staleTab.close()]);
});

drillCase("CC-03", async ({ page, artifact }) => {
  const { floodStorageEvents } = await import("./faults");
  const baseline = makeDrillStudy({ revision: 3 });
  await page.goto("/library");
  await page.evaluate(
    ([key, raw]) => window.localStorage.setItem(key, raw),
    ["signal-commons.workspace.v1", JSON.stringify(baseline)] as const,
  );
  await page.reload();
  await expect(page.getByText("Drill signal 1").first()).toBeVisible();

  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const sameRecord = makeDrillStudy({ revision: 3 });
  await floodStorageEvents(page, sameRecord, 20);
  await page.waitForTimeout(300);

  const persisted = await page.evaluate(
    ([key]) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as { stateJson: string };
      return JSON.parse(envelope.stateJson) as {
        revision: number;
        recordings: unknown[];
      };
    },
    ["signal-commons.workspace.v1"] as const,
  );
  expect(persisted?.revision).toBe(3);
  expect(persisted?.recordings).toHaveLength(baseline.recordings.length);
  expect(consoleErrors).toEqual([]);

  // The page must remain fully usable after the storm.
  await addRecordingViaUi(page, 9);
  const advanced = await waitForPersistedRevision(page, 4);
  expect(advanced.recordings).toHaveLength(baseline.recordings.length + 1);

  await artifact("cc-03-event-flood.json", {
    duplicateEvents: 20,
    consoleErrors,
    finalRevision: advanced.revision,
  });
});
