import { createId } from "../domain/ids";
import { compactLog, makeLogEntry } from "../domain/studyLog";
import type { StudyState } from "../domain/models";
import type { StudyAction } from "./actions";

export const AUDIT_LOG_LIMIT = 80;

export type CommandDisposition = "apply" | "duplicate" | "conflict";

/**
 * Decides how a command may be applied: repeated command IDs are idempotent,
 * while commands issued against a stale revision are rejected.
 */
export function commandDisposition(
  state: StudyState,
  action: StudyAction,
): CommandDisposition {
  const meta = action.meta;
  if (!meta) return "apply";
  if (state.auditLog.some((entry) => entry.commandId === meta.commandId))
    return "duplicate";
  return meta.expectedRevision === state.revision ? "apply" : "conflict";
}

/**
 * Commits a mutation to the workspace: bumps the content revision, stamps the
 * update times, and appends a bounded audit log entry.
 */
export function finalizeAction(
  state: StudyState,
  action: StudyAction,
  revision: number,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  const entry = makeLogEntry(action, createId("event"), revision, at);
  return {
    ...state,
    revision,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
    auditLog: compactLog([...state.auditLog, entry], AUDIT_LOG_LIMIT),
  };
}

/**
 * Records a rejected command in the audit log without changing content.
 */
export function rejectCommand(
  state: StudyState,
  action: StudyAction,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  return {
    ...state,
    lastSavedAt: timestamp,
    auditLog: compactLog(
      [
        ...state.auditLog,
        makeLogEntry(
          action,
          action.meta?.commandId ?? createId("event"),
          state.revision,
          at,
          "system",
          "rejected",
        ),
      ],
      AUDIT_LOG_LIMIT,
    ),
  };
}

/**
 * Any release-relevant change marks a frozen release stale so exports are
 * blocked until the next successful readiness check.
 */
export function invalidateRelease(state: StudyState): StudyState {
  if (!state.release || state.release.status === "stale") return state;
  return {
    ...state,
    release: { ...state.release, status: "stale" },
  };
}

/**
 * Wraps a content mutation with the command pipeline: no-ops pass through,
 * duplicates are dropped, conflicts are rejected and logged, and applied
 * commands invalidate the frozen release before being committed at the next
 * revision.
 */
export function applyMutation(
  state: StudyState,
  action: StudyAction,
  next: StudyState,
): StudyState {
  if (next === state) return state;
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  return finalizeAction(invalidateRelease(next), action, state.revision + 1);
}

/**
 * Commits a readiness release record. Unlike content mutations this does not
 * bump the content revision: the frozen release is bound to the revision it
 * was checked against.
 */
export function applyReleaseRecord(
  state: StudyState,
  action: StudyAction,
  staged: StudyState,
): StudyState {
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  return finalizeAction(staged, action, state.revision);
}
