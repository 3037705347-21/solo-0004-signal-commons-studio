import type { IssueStatus } from "../domain/models";

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
