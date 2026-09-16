import type {
  ConflictDraft,
  ConflictRecord,
  IssueStatus,
  StudyState,
} from "../domain/models";
import { createSeedStudy } from "./seed";
import { migrateWorkspace, validateReferences } from "./migrations";

export const STORAGE_KEY = "signal-commons.workspace.v1";
export const STORAGE_BACKUP_KEY = "signal-commons.workspace.backup.v1";
export const REVIEW_UI_KEY = "signal-commons.review-ui.v1";
export const CONFLICTS_KEY = "signal-commons.conflicts.v1";
export const DRAFTS_KEY = "signal-commons.conflict-drafts.v1";
const STORAGE_ENVELOPE_VERSION = 1;
const MAX_CONFLICTS = 10;

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
  try {
    const previous = storage.getItem(STORAGE_KEY);
    if (previous) storage.setItem(STORAGE_BACKUP_KEY, previous);
    const stateJson = JSON.stringify(state);
    const envelope: StorageEnvelope = {
      storageVersion: STORAGE_ENVELOPE_VERSION,
      checksum: fnv1a(stateJson),
      stateJson,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Revision/updatedAt signature identifying the record a tab last synced to. */
function stateSignature(state: StudyState): string {
  return `${state.revision}|${state.updatedAt}`;
}

export type CommitOutcome =
  | { status: "committed"; signature: string }
  | { status: "identical"; signature: string }
  | { status: "diverged"; committed: StudyState }
  | { status: "unavailable" };

/**
 * Commit a local state to the checksummed primary. When another tab committed
 * after the local tab last synced (`expectedSignature` no longer matches the
 * stored record), the write is refused and the committed record is returned so
 * the caller can open the conflict resolver instead of overwriting their work.
 */
export function commitWorkspace(
  state: StudyState,
  expectedSignature: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): CommitOutcome {
  try {
    const stored = readStoredStudy(storage.getItem(STORAGE_KEY));
    if (stored) {
      if (stateSignature(stored) === stateSignature(state))
        return { status: "identical", signature: stateSignature(state) };
      if (
        expectedSignature !== null &&
        stateSignature(stored) !== expectedSignature
      ) {
        return { status: "diverged", committed: validateReferences(stored) };
      }
    }
    if (!saveStudy(state, storage)) return { status: "unavailable" };
    return { status: "committed", signature: stateSignature(state) };
  } catch {
    return { status: "unavailable" };
  }
}

function migrateSnapshots(
  value: unknown,
): Pick<ConflictRecord, "base" | "ours" | "theirs"> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const base = migrateWorkspace(record.base);
  const ours = migrateWorkspace(record.ours);
  const theirs = migrateWorkspace(record.theirs);
  if (!base || !ours || !theirs) return null;
  return {
    base: validateReferences(base),
    ours: validateReferences(ours),
    theirs: validateReferences(theirs),
  };
}

function readJsonList<T>(
  key: string,
  revive: (value: Record<string, unknown>) => T | null,
  storage: Pick<Storage, "getItem"> = localStorage,
): T[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) =>
        entry && typeof entry === "object"
          ? revive(entry as Record<string, unknown>)
          : null,
      )
      .filter((entry): entry is T => Boolean(entry));
  } catch {
    return [];
  }
}

export function loadConflicts(
  storage: Pick<Storage, "getItem"> = localStorage,
): ConflictRecord[] {
  return readJsonList(CONFLICTS_KEY, (entry) => {
    const snapshots = migrateSnapshots(entry);
    if (!snapshots) return null;
    if (
      typeof entry.id !== "string" ||
      typeof entry.detectedAt !== "string" ||
      typeof entry.originId !== "string" ||
      typeof entry.commandSummary !== "string" ||
      !Number.isInteger(entry.baseRevision) ||
      !Number.isInteger(entry.oursRevision) ||
      !Number.isInteger(entry.theirsRevision)
    )
      return null;
    return {
      id: entry.id,
      detectedAt: entry.detectedAt,
      originId: entry.originId,
      originLabel:
        typeof entry.originLabel === "string" ? entry.originLabel : "Another tab",
      commandSummary: entry.commandSummary,
      baseRevision: Number(entry.baseRevision),
      oursRevision: Number(entry.oursRevision),
      theirsRevision: Number(entry.theirsRevision),
      ...snapshots,
    };
  }, storage);
}

export function saveConflicts(
  conflicts: ConflictRecord[],
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(
      CONFLICTS_KEY,
      JSON.stringify(conflicts.slice(-MAX_CONFLICTS)),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop conflicts a synced revision already resolved. The resolving tab prunes
 * its own list in a separate write that can land *after* this tab processes the
 * workspace event; re-saving the pending list at that point would resurrect the
 * resolved conflict. Resolution entries carry the resolved conflict id so the
 * pruning happens deterministically from the committed document itself.
 */
export function pruneResolvedConflicts(
  conflicts: ConflictRecord[],
  incoming: StudyState,
): ConflictRecord[] {
  const resolvedIds = new Set(
    incoming.auditLog
      .filter((entry) => entry.action === "conflict/resolve")
      .map((entry) => entry.conflictId)
      .filter((id): id is string => typeof id === "string"),
  );
  return conflicts.filter((conflict) => !resolvedIds.has(conflict.id));
}

export function loadDrafts(
  storage: Pick<Storage, "getItem"> = localStorage,
): ConflictDraft[] {
  return readJsonList(DRAFTS_KEY, (entry) => {
    const snapshots = migrateSnapshots(entry);
    if (!snapshots) return null;
    if (
      typeof entry.id !== "string" ||
      typeof entry.createdAt !== "string" ||
      typeof entry.originId !== "string" ||
      typeof entry.commandSummary !== "string"
    )
      return null;
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      originId: entry.originId,
      commandSummary: entry.commandSummary,
      baseRevision: Number(entry.baseRevision) || 0,
      theirsRevision: Number(entry.theirsRevision) || 0,
      ...snapshots,
    };
  }, storage);
}

export function saveDrafts(
  drafts: ConflictDraft[],
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(-MAX_CONFLICTS)));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspace(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(STORAGE_BACKUP_KEY);
  storage.removeItem(CONFLICTS_KEY);
  storage.removeItem(DRAFTS_KEY);
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
