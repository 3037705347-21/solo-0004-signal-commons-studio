import type { IssueStatus, StudyState } from "../domain/models";
import type { BatchSession } from "../domain/batchImport";
import { createSeedStudy } from "./seed";
import { migrateWorkspace, validateReferences } from "./migrations";

export const STORAGE_KEY = "signal-commons.workspace.v1";
export const STORAGE_BACKUP_KEY = "signal-commons.workspace.backup.v1";
export const REVIEW_UI_KEY = "signal-commons.review-ui.v1";
export const BATCH_DRAFT_KEY = "signal-commons.batch-draft.v1";
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

export function clearWorkspace(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(STORAGE_BACKUP_KEY);
  storage.removeItem(BATCH_DRAFT_KEY);
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

export interface BatchDraftRecord {
  savedAt: string;
  step: "compose" | "review";
  /** Pasted source retained while still on the compose step. */
  rawText?: string;
  /** Parsed, editable batch once the review step has been reached. */
  session?: BatchSession;
}

function sessionShapeValid(
  session: (Partial<BatchSession> & { fileErrors?: unknown }) | undefined,
): boolean {
  if (!session || !Array.isArray(session.rows)) return false;
  // Drafts written before file errors existed carry no fileErrors field.
  if ("fileErrors" in session && !Array.isArray(session.fileErrors)) return false;
  return (
    typeof session.batchId === "string" &&
    typeof session.label === "string" &&
    // A batch with no readable rows is still resumable when the file
    // defect that blocked it is carried on the draft.
    (session.rows.length > 0 ||
      (Array.isArray(session.fileErrors) && session.fileErrors.length > 0))
  );
}

function isBatchDraft(value: unknown): value is BatchDraftRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BatchDraftRecord>;
  if (
    typeof candidate.savedAt !== "string" ||
    (candidate.step !== "compose" && candidate.step !== "review")
  )
    return false;
  // A review-step draft must carry the parsed, editable session. A compose
  // draft only needs its pasted source (it may also carry a parsed session).
  if (candidate.step === "review") return sessionShapeValid(candidate.session);
  return (
    typeof candidate.rawText === "string" ||
    sessionShapeValid(candidate.session)
  );
}

export function loadBatchDraft(
  storage: Pick<Storage, "getItem"> = localStorage,
): BatchDraftRecord | null {
  try {
    const raw = storage.getItem(BATCH_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBatchDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBatchDraft(
  draft: BatchDraftRecord | null,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): boolean {
  try {
    if (!draft) {
      storage.removeItem(BATCH_DRAFT_KEY);
      return true;
    }
    storage.setItem(BATCH_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
