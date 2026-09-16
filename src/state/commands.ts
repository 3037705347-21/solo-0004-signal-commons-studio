import { createId } from "../domain/ids";
import {
  placementBlocker,
  reorderBlocker,
} from "../domain/placements";
import {
  recordingFromDraft,
  validateRecordingDraft,
} from "../domain/recordingValidation";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
  isReleaseCurrent,
} from "../domain/releaseRules";
import { issueTransitionBlocker } from "../domain/transitions";
import type {
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
} from "../domain/models";
import { createSeedStudy } from "./seed";
import type { CommandMeta, StudyAction } from "./actions";

export interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

/**
 * A planned command: either a dispatchable action plus an optional return
 * value, or a validation failure the caller can surface directly.
 */
export type CommandPlan<T = undefined> =
  | { ok: true; action: StudyAction; value?: T }
  | { ok: false; errors?: Record<string, string>; message?: string };

/**
 * Command metadata attaches optimistic-concurrency and idempotency identity to
 * every state-changing action.
 */
export function createCommandMeta(
  expectedRevision: number,
  originId: string,
  at = new Date(),
): CommandMeta {
  return {
    commandId: createId("command"),
    expectedRevision,
    originId,
    issuedAt: at.toISOString(),
  };
}

export function withCommandMeta(
  action: StudyAction,
  meta: CommandMeta,
): StudyAction {
  return { ...action, meta };
}

export function planUpsertRecording(
  state: StudyState,
  draft: RecordingDraft,
  existing?: Recording,
): CommandPlan<Recording> {
  const validation = validateRecordingDraft(
    draft,
    state.recordings,
    existing?.id,
  );
  if (validation.length) {
    return {
      ok: false,
      errors: Object.fromEntries(
        validation.map((error) => [error.field, error.message]),
      ),
      message: "Review the highlighted fields before saving.",
    };
  }
  const recording = recordingFromDraft(draft, existing);
  return { ok: true, action: { type: "recording/upsert", recording }, value: recording };
}

export function planRemoveRecording(
  state: StudyState,
  recordingId: string,
): CommandPlan {
  const recording = state.recordings.find(
    (candidate) => candidate.id === recordingId,
  );
  if (!recording)
    return { ok: false, message: "The selected clip no longer exists." };
  return { ok: true, action: { type: "recording/remove", recordingId } };
}

export function planAssignRecording(
  state: StudyState,
  recordingId: string,
  siteId: string,
  index?: number,
): CommandPlan {
  const blocker = placementBlocker(state, recordingId, siteId);
  if (blocker) return { ok: false, message: blocker };
  return {
    ok: true,
    action:
      index === undefined
        ? { type: "placement/assign", recordingId, siteId }
        : { type: "placement/assign", recordingId, siteId, index },
  };
}

export function planRemovePlacement(recordingId: string): CommandPlan {
  return { ok: true, action: { type: "placement/remove", recordingId } };
}

export function planReorderRecording(
  state: StudyState,
  siteId: string,
  recordingId: string,
  direction: -1 | 1,
): CommandPlan {
  const blocker = reorderBlocker(state, siteId, recordingId);
  if (blocker) return { ok: false, message: blocker };
  return {
    ok: true,
    action: { type: "placement/reorder", siteId, recordingId, direction },
  };
}

export function planAddIssue(
  draft: IssueDraft,
  at = new Date(),
  issueId = createId("issue"),
): CommandPlan {
  if (!draft.title.trim())
    return { ok: false, errors: { title: "A finding title is required." } };
  if (draft.description.trim().length < 16)
    return {
      ok: false,
      errors: { description: "Add at least 16 characters of context." },
    };
  if (!draft.owner.trim())
    return { ok: false, errors: { owner: "Assign an owner." } };
  const now = at.toISOString();
  return {
    ok: true,
    action: {
      type: "issue/add",
      issue: {
        id: issueId,
        title: draft.title.trim(),
        description: draft.description.trim(),
        severity: draft.severity,
        status: "open",
        owner: draft.owner.trim(),
        siteId: draft.siteId || undefined,
        recordingId: draft.recordingId || undefined,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}

export function planTransitionIssue(
  state: StudyState,
  issueId: string,
  status: IssueStatus,
): CommandPlan {
  const issue = state.issues.find((candidate) => candidate.id === issueId);
  if (!issue)
    return {
      ok: false,
      message: "The selected review finding no longer exists.",
    };
  const blocker = issueTransitionBlocker(issue, status);
  if (blocker) return { ok: false, message: blocker };
  return { ok: true, action: { type: "issue/transition", issueId, status } };
}

export function planUpdatePreferences(
  preferences: RoutePreferences,
): CommandPlan {
  return { ok: true, action: { type: "preferences/update", preferences } };
}

/**
 * Composes the release check: route analysis, readiness evaluation, and the
 * frozen release record become a single dispatchable action.
 */
export function planReadinessCheck(
  state: StudyState,
  at = new Date(),
): { action: StudyAction; result: ReleaseResult } {
  const analysis = analyzeRoute(state.recordings, state.sites);
  const result = evaluateRelease(state, analysis, at);
  return {
    action: {
      type: "project/readiness",
      release: createReleaseRecord(state, analysis, result),
    },
    result,
  };
}

/**
 * Gates snapshot export on a current, passing release.
 */
export function planSnapshotExport(state: StudyState): CommandResult<Snapshot> {
  if (!isReleaseCurrent(state, state.release))
    return {
      ok: false,
      message:
        state.release?.readiness.blockers[0] ??
        "Run a current readiness check before exporting.",
    };
  return {
    ok: true,
    value: state.release.snapshot,
  };
}

export function planWorkspaceReset(): CommandPlan {
  return { ok: true, action: { type: "workspace/reset", state: createSeedStudy() } };
}
