import {
  assignRecording,
  removeRecordingFromSites,
  reorderRecording,
} from "../domain/placements";
import {
  applyReadinessStage,
  regressReadyProject,
  transitionIssue,
} from "../domain/transitions";
import type { StudyState } from "../domain/models";
import type { StudyAction } from "./actions";
import { applyMutation, applyReleaseRecord } from "./commandPipeline";

/**
 * Maps workspace actions to state transitions. Domain mutations live in
 * `domain/`; command disposition, audit, and release lifecycle semantics live
 * in `commandPipeline`. This reducer only composes the two.
 */
export function workspaceReducer(
  state: StudyState,
  action: StudyAction,
): StudyState {
  switch (action.type) {
    case "recording/upsert": {
      const exists = state.recordings.some(
        (recording) => recording.id === action.recording.id,
      );
      const recordings = exists
        ? state.recordings.map((recording) =>
            recording.id === action.recording.id ? action.recording : recording,
          )
        : [...state.recordings, action.recording];
      return applyMutation(
        state,
        action,
        regressReadyProject({ ...state, recordings }),
      );
    }
    case "recording/remove": {
      const withoutPlacement = removeRecordingFromSites(
        state,
        action.recordingId,
      );
      return applyMutation(
        state,
        action,
        regressReadyProject({
          ...withoutPlacement,
          recordings: withoutPlacement.recordings.filter(
            (recording) => recording.id !== action.recordingId,
          ),
          issues: withoutPlacement.issues.filter(
            (issue) => issue.recordingId !== action.recordingId,
          ),
        }),
      );
    }
    case "placement/assign":
      return applyMutation(
        state,
        action,
        regressReadyProject(
          assignRecording(
            state,
            action.recordingId,
            action.siteId,
            action.index,
          ),
        ),
      );
    case "placement/remove":
      return applyMutation(
        state,
        action,
        regressReadyProject(
          removeRecordingFromSites(state, action.recordingId),
        ),
      );
    case "placement/reorder":
      return applyMutation(
        state,
        action,
        regressReadyProject(
          reorderRecording(
            state,
            action.siteId,
            action.recordingId,
            action.direction,
          ),
        ),
      );
    case "issue/add":
      return applyMutation(
        state,
        action,
        regressReadyProject({
          ...state,
          issues: [action.issue, ...state.issues],
        }),
      );
    case "issue/transition":
      return applyMutation(
        state,
        action,
        regressReadyProject({
          ...state,
          issues: state.issues.map((issue) =>
            issue.id === action.issueId
              ? transitionIssue(issue, action.status, action.at)
              : issue,
          ),
        }),
      );
    case "preferences/update":
      return applyMutation(
        state,
        action,
        regressReadyProject({ ...state, preferences: action.preferences }),
      );
    case "project/readiness": {
      const staged = applyReadinessStage(
        state,
        action.release.readiness.ready,
      );
      return applyReleaseRecord(state, action, {
        ...staged,
        project: {
          ...staged.project,
          lastReadinessCheck: action.release.readiness.checkedAt,
        },
        release: action.release,
      });
    }
    case "workspace/reset":
      return action.state;
    case "workspace/sync":
      return action.state;
    default:
      return state;
  }
}
