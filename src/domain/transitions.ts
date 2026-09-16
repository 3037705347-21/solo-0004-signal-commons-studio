import type {
  IssueStatus,
  ProjectStage,
  QualityIssue,
  StudyState,
} from "./models";

const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ["in-progress"],
  "in-progress": ["open", "resolved"],
  resolved: ["in-progress"],
};

const PROJECT_TRANSITIONS: Record<ProjectStage, ProjectStage[]> = {
  draft: ["review"],
  review: ["draft", "ready"],
  ready: ["review"],
};

export class TransitionError extends Error {
  constructor(
    message: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

/**
 * Returns the reason an issue cannot move to the target status, or null when
 * the transition is allowed. Shared by the command planner (pre-validation)
 * and `transitionIssue` so both reject with the same message.
 */
export function issueTransitionBlocker(
  issue: QualityIssue,
  target: IssueStatus,
): string | null {
  if (issue.status === target) return null;
  return ISSUE_TRANSITIONS[issue.status].includes(target)
    ? null
    : `Cannot move a review finding from ${issue.status} to ${target}.`;
}

export function transitionIssue(
  issue: QualityIssue,
  target: IssueStatus,
  at = new Date(),
): QualityIssue {
  if (issue.status === target) return issue;
  const blocker = issueTransitionBlocker(issue, target);
  if (blocker) {
    throw new TransitionError(blocker, issue.status, target);
  }
  const timestamp = at.toISOString();
  return {
    ...issue,
    status: target,
    updatedAt: timestamp,
    resolvedAt: target === "resolved" ? timestamp : undefined,
  };
}

export function transitionProject(
  state: StudyState,
  target: ProjectStage,
): StudyState {
  const source = state.project.stage;
  if (source === target) return state;
  if (!PROJECT_TRANSITIONS[source].includes(target)) {
    throw new TransitionError(
      `Cannot move the project from ${source} to ${target}.`,
      source,
      target,
    );
  }
  return { ...state, project: { ...state.project, stage: target } };
}

export function regressReadyProject(state: StudyState): StudyState {
  if (state.project.stage !== "ready") return state;
  return { ...state, project: { ...state.project, stage: "review" } };
}

/**
 * Drives the project stage machine after a readiness check: a passing check
 * walks the project towards `ready`, while a failing one regresses a ready
 * project back to `review`.
 */
export function applyReadinessStage(
  state: StudyState,
  ready: boolean,
): StudyState {
  if (!ready) {
    return state.project.stage === "ready"
      ? transitionProject(state, "review")
      : state;
  }
  const reviewState =
    state.project.stage === "draft"
      ? transitionProject(state, "review")
      : state;
  return reviewState.project.stage === "review"
    ? transitionProject(reviewState, "ready")
    : reviewState;
}
