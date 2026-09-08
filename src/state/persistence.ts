import type { IssueStatus, StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import { migrateWorkspace, validateReferences } from "./migrations";

export const STORAGE_KEY = "signal-commons.workspace.v1";
export const REVIEW_UI_KEY = "signal-commons.review-ui.v1";

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

function isStudyState(value: unknown): value is StudyState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudyState>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.project) &&
    Array.isArray(candidate.recordings) &&
    Array.isArray(candidate.sites) &&
    Array.isArray(candidate.issues) &&
    Boolean(candidate.preferences)
  );
}

export function loadStudy(
  storage: Pick<Storage, "getItem"> = localStorage,
): StudyState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createSeedStudy();
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateWorkspace(parsed);
    return migrated && isStudyState(migrated)
      ? validateReferences(migrated)
      : createSeedStudy();
  } catch {
    return createSeedStudy();
  }
}

export function saveStudy(
  state: StudyState,
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspace(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
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
