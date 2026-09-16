import type { IssueStatus, StudyState } from "../domain/models";
import { releaseFingerprint } from "../domain/releaseIdentity";
import { createSeedStudy } from "./seed";
import { migrateWorkspace, validateReferences } from "./migrations";

export const STORAGE_KEY = "signal-commons.workspace.v1";
export const STORAGE_BACKUP_KEY = "signal-commons.workspace.backup.v1";
export const REVIEW_UI_KEY = "signal-commons.review-ui.v1";
const STORAGE_ENVELOPE_VERSION = 1;

interface StorageEnvelope {
  storageVersion: typeof STORAGE_ENVELOPE_VERSION;
  checksum: string;
  stateJson: string;
}

export interface ReviewUiState {
  siteId: string;
  status: IssueStatus | "all";
}

const DEFAULT_REVIEW_UI: ReviewUiState = { siteId: "", status: "all" };
const ISSUE_STATUSES: Array<IssueStatus | "all"> = [
  "all",
  "open",
  "in-progress",
  "resolved",
];

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readStoredStudy(raw: string | null): StudyState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as Partial<StorageEnvelope>).storageVersion ===
        STORAGE_ENVELOPE_VERSION
    ) {
      const envelope = parsed as Partial<StorageEnvelope>;
      if (
        typeof envelope.stateJson !== "string" ||
        typeof envelope.checksum !== "string" ||
        fnv1a(envelope.stateJson) !== envelope.checksum
      )
        return null;
      return migrateWorkspace(JSON.parse(envelope.stateJson));
    }
    return migrateWorkspace(parsed);
  } catch {
    return null;
  }
}

/**
 * Read and migrate the raw primary record without falling back to the backup
 * or sample study. Concurrent-commit guards use this to inspect what is
 * actually on disk before writing.
 */
export function readStoredPrimary(
  storage: Pick<Storage, "getItem"> = localStorage,
): StudyState | null {
  return readStoredStudy(storage.getItem(STORAGE_KEY));
}

/** Content identity used to detect equal-revision divergence between tabs. */
export function storageStateFingerprint(state: StudyState): string {
  return releaseFingerprint(validateReferences(state));
}

/**
 * True when the disk record must win over an in-memory state: a strictly
 * newer content revision, or the same revision carrying different content
 * (for example another tab's readiness check). Equal revision and content is
 * a harmless rewrite, and missing or unreadable disk never blocks a commit.
 */
export function diskAheadOf(
  disk: StudyState | null,
  state: StudyState,
): disk is StudyState {
  if (!disk) return false;
  if (disk.revision > state.revision) return true;
  if (disk.revision < state.revision) return false;
  return storageStateFingerprint(disk) !== storageStateFingerprint(state);
}

export type CommitResult =
  | { outcome: "saved" }
  | { outcome: "quota-error" }
  | { outcome: "disk-ahead"; disk: StudyState };

/**
 * Revision-guarded persistence write. The primary record is read one last
 * time before rotating the backup; if another tab committed in the meantime,
 * the stale in-memory state is refused and the winner is returned so the
 * caller can heal its workspace instead of overwriting committed work.
 */
export function commitStudy(
  state: StudyState,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): CommitResult {
  try {
    const disk = readStoredPrimary(storage);
    if (diskAheadOf(disk, state)) return { outcome: "disk-ahead", disk };
    const previous = storage.getItem(STORAGE_KEY);
    if (previous) storage.setItem(STORAGE_BACKUP_KEY, previous);
    const stateJson = JSON.stringify(state);
    const envelope: StorageEnvelope = {
      storageVersion: STORAGE_ENVELOPE_VERSION,
      checksum: fnv1a(stateJson),
      stateJson,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return { outcome: "saved" };
  } catch {
    return { outcome: "quota-error" };
  }
}

export function loadStudy(
  storage: Pick<Storage, "getItem"> = localStorage,
): StudyState {
  try {
    const primary = readStoredStudy(storage.getItem(STORAGE_KEY));
    if (primary) return validateReferences(primary);
    const backup = readStoredStudy(storage.getItem(STORAGE_BACKUP_KEY));
    return backup ? validateReferences(backup) : createSeedStudy();
  } catch {
    return createSeedStudy();
  }
}

export function saveStudy(
  state: StudyState,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): boolean {
  const result = commitStudy(state, storage);
  // Callers using the legacy boolean form treat both a successful write and a
  // refused stale commit as "storage healthy"; only quota failures surface as
  // unavailable storage. The StudyProvider acts on the structured result.
  return result.outcome !== "quota-error";
}

export function clearWorkspace(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(STORAGE_BACKUP_KEY);
}

export function loadReviewUi(
  storage: Pick<Storage, "getItem"> = localStorage,
): ReviewUiState {
  try {
    const raw = storage.getItem(REVIEW_UI_KEY);
    if (!raw) return DEFAULT_REVIEW_UI;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_REVIEW_UI;
    const candidate = parsed as Partial<ReviewUiState>;
    const status: IssueStatus | "all" = ISSUE_STATUSES.includes(
      candidate.status as IssueStatus | "all",
    )
      ? (candidate.status as IssueStatus | "all")
      : "all";
    return {
      siteId: typeof candidate.siteId === "string" ? candidate.siteId : "",
      status,
    };
  } catch {
    return DEFAULT_REVIEW_UI;
  }
}

export function saveReviewUi(
  ui: ReviewUiState,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(REVIEW_UI_KEY, JSON.stringify(ui));
  } catch {
    // UI preferences are non-critical; ignore storage failures.
  }
}
