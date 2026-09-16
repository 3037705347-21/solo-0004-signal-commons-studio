import type { BrowserContext, Page } from "@playwright/test";
import type { StudyState } from "../../src/domain/models";
import {
  DRILL_BACKUP_KEY,
  DRILL_REVIEW_UI_KEY,
  DRILL_STORAGE_KEY,
  makeEnvelope,
} from "./fixtures";

/**
 * Deterministic fault primitives for chaos drills.
 *
 * Each primitive models one real-world failure (crash, corrupt write, storage
 * outage, cross-tab event flood, scale) and is paired with a recovery action.
 * Primitives only touch the isolated browser context handed to a drill, never
 * the runner machine or other tests.
 */

export interface RawWorkspaceRecord {
  primary: string | null;
  backup: string | null;
}

// ---- Storage isolation ---------------------------------------------------

/** Remove every workspace key from every open page in the context. */
export async function purgeWorkspace(context: BrowserContext): Promise<void> {
  await Promise.all(
    context.pages().map((page) =>
      page.evaluate(
        ([key, backup, uiKey]) => {
          window.localStorage.removeItem(key);
          window.localStorage.removeItem(backup);
          window.localStorage.removeItem(uiKey);
        },
        [DRILL_STORAGE_KEY, DRILL_BACKUP_KEY, DRILL_REVIEW_UI_KEY] as const,
      ),
    ),
  );
}

async function seedOnPage(
  page: Page,
  raw: string,
  backup: string | null,
): Promise<void> {
  await page.evaluate(
    ([key, backupKey, value, backupValue]) => {
      window.localStorage.setItem(key, value);
      if (backupValue) window.localStorage.setItem(backupKey, backupValue);
      else window.localStorage.removeItem(backupKey);
    },
    [DRILL_STORAGE_KEY, DRILL_BACKUP_KEY, raw, backup] as const,
  );
}

/** Seed the checksummed primary, optionally with an explicit backup record. */
export async function seedWorkspace(
  context: BrowserContext,
  state: StudyState,
  options: { backup?: StudyState; rawOverride?: string } = {},
): Promise<void> {
  await purgeWorkspace(context);
  const page = context.pages()[0];
  if (!page) throw new Error("seedWorkspace needs at least one open page");
  await seedOnPage(
    page,
    options.rawOverride ?? makeEnvelope(state),
    options.backup ? makeEnvelope(options.backup) : null,
  );
}

// ---- Observation ---------------------------------------------------------

export async function readRawWorkspace(
  page: Page,
): Promise<RawWorkspaceRecord> {
  return page.evaluate(
    ([key, backupKey]) => ({
      primary: window.localStorage.getItem(key),
      backup: window.localStorage.getItem(backupKey),
    }),
    [DRILL_STORAGE_KEY, DRILL_BACKUP_KEY] as const,
  );
}

export async function readPersistedStudy(
  page: Page,
): Promise<StudyState | null> {
  const raw = await readRawWorkspace(page);
  if (!raw.primary) return null;
  return page.evaluate(
    (value) => {
      try {
        const envelope = JSON.parse(value) as {
          storageVersion?: number;
          stateJson?: string;
        };
        const stateJson =
          envelope && envelope.storageVersion === 1 && envelope.stateJson
            ? envelope.stateJson
            : value;
        return JSON.parse(stateJson) as StudyState;
      } catch {
        return null;
      }
    },
    raw.primary,
  );
}

export async function waitForPersistedRevision(
  page: Page,
  revision: number,
  timeoutMs = 5_000,
): Promise<StudyState> {
  const deadline = Date.now() + timeoutMs;
  // Date.now is fine in the runner: determinism applies to the *app data*,
  // not to how long the test polls for a React effect to flush.
  while (Date.now() < deadline) {
    const state = await readPersistedStudy(page);
    if (state && state.revision >= revision) return state;
    await page.waitForTimeout(25);
  }
  const state = await readPersistedStudy(page);
  throw new Error(
    `Persisted revision did not reach ${revision} (last seen: ${state?.revision ?? "none"})`,
  );
}

// ---- Faults: abrupt interruption ----------------------------------------

/**
 * Crash model: the renderer disappears while the page is mounted. The
 * storage write already flushed synchronously, so reopening must show the
 * last committed state with no half-written record.
 */
export async function crashRenderer(page: Page): Promise<void> {
  await page.close({ runBeforeUnload: false });
}

// ---- Faults: storage outage ---------------------------------------------

/**
 * Install a switchable storage outage before app code loads. While
 * `window.__drillStorageDown` is true every write throws a quota error; reads
 * keep working, so the drill can seed a healthy record, throw the outage, and
 * flip it back off to verify recovery.
 */
export async function installStorageOutageSwitch(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const w = window as Window & { __drillStorageDown?: boolean };
    w.__drillStorageDown = false;
    const proto = window.Storage.prototype;
    const original = proto.setItem;
    proto.setItem = function switchableFailSetItem(
      this: Storage,
      ...args: Parameters<Storage["setItem"]>
    ) {
      if (w.__drillStorageDown) {
        throw new DOMException(
          "Simulated storage quota exceeded",
          "QuotaExceededError",
        );
      }
      return original.apply(this, args);
    };
  });
}

export async function setStorageOutage(
  page: Page,
  active: boolean,
): Promise<void> {
  await page.evaluate((value) => {
    (window as Window & { __drillStorageDown?: boolean }).__drillStorageDown =
      value;
  }, active);
}

// ---- Faults: corrupt records --------------------------------------------

/** Overwrite the live primary with arbitrary bytes (checksum invalid). */
export async function corruptPrimary(
  page: Page,
  raw: string,
): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [DRILL_STORAGE_KEY, raw] as const,
  );
}

// ---- Faults: cross-tab event storms -------------------------------------

/**
 * Fire duplicate and stale `storage` events at a target page. Synthetic
 * dispatchEvent calls reach same-window listeners (the "other documents only"
 * rule applies to browser-fired events), so each event is dispatched inside
 * the target page itself. The handler must stay idempotent: the visible
 * revision must never move backwards and no event may crash it.
 */
export async function floodStorageEvents(
  target: Page,
  state: StudyState,
  copies = 20,
): Promise<void> {
  const raw = makeEnvelope(state);
  for (let index = 0; index < copies; index += 1) {
    await target.evaluate(
      ([key, value, url]) => {
        const event = new StorageEvent("storage", {
          key,
          oldValue: null,
          newValue: value,
          url,
          storageArea: window.localStorage,
        });
        window.dispatchEvent(event);
      },
      [DRILL_STORAGE_KEY, raw, target.url()] as const,
    );
  }
}

// ---- Deterministic UI action helpers ------------------------------------

/** Fill the library "new clip" form on an already-open /library page. */
export async function fillRecordingForm(
  page: Page,
  sequence: number,
  catalogPrefix = "SC-DRILL-NEW",
): Promise<void> {
  const id = `${catalogPrefix}-${String(sequence).padStart(3, "0")}`;
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill(id);
  await page.getByLabel("Title").fill(`Concurrent signal ${sequence}`);
  await page.getByLabel("Recorder / source").fill("Drill team");
  await page.getByLabel("Recording date").fill("2026-08-20");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Drill station");
  await page
    .getByLabel("Clip summary")
    .fill(
      `Deterministic concurrent drill clip number ${sequence} committed from a live tab.`,
    );
}

/** Submit the open new-clip form and wait for the card to appear. */
export async function submitRecordingForm(
  page: Page,
  sequence: number,
): Promise<void> {
  await page.getByRole("button", { name: "Add clip" }).last().click();
  await expectClipVisible(page, `Concurrent signal ${sequence}`);
}

/**
 * Submit the open form without waiting for the card. Used when the commit is
 * expected to be refused by the revision guard and the card must not appear.
 */
export async function submitRecordingFormUnchecked(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add clip" }).last().click();
}

async function expectClipVisible(page: Page, text: string): Promise<void> {
  await page.getByText(text).first().waitFor({
    state: "visible",
    timeout: 5_000,
  });
}

/**
 * Add one recording through the library form using fixed drill inputs.
 * Navigates to /library; callers simulating a stale tab must fill the form
 * with fillRecordingForm instead, because any reload would resync to disk.
 */
export async function addRecordingViaUi(
  page: Page,
  sequence: number,
): Promise<void> {
  await page.goto("/library");
  await fillRecordingForm(page, sequence);
  await submitRecordingForm(page, sequence);
}
