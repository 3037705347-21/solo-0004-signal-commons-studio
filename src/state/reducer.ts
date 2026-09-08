import { regressReadyProject, transitionIssue } from "../domain/transitions";
import type { StudyState } from "../domain/models";
import type { StudyAction } from "./actions";

function stamp(state: StudyState): StudyState {
  return { ...state, lastSavedAt: new Date().toISOString() };
}

function removeRecordingFromSites(
  state: StudyState,
  recordingId: string,
): StudyState {
  return {
    ...state,
    sites: state.sites.map((site) => ({
      ...site,
      recordingIds: site.recordingIds.filter((id) => id !== recordingId),
    })),
  };
}

function assignRecording(
  state: StudyState,
  recordingId: string,
  siteId: string,
  index?: number,
): StudyState {
  if (!state.recordings.some((recording) => recording.id === recordingId)) {
    throw new Error("Cannot place a clip that is not in the library.");
  }
  if (!state.sites.some((site) => site.id === siteId)) {
    throw new Error("Cannot place an recording in an unknown site.");
  }
  const removed = removeRecordingFromSites(state, recordingId);
  return {
    ...removed,
    sites: removed.sites.map((site) => {
      if (site.id !== siteId) return site;
      const targetIndex =
        index === undefined
          ? site.recordingIds.length
          : Math.max(0, Math.min(index, site.recordingIds.length));
      const recordingIds = [...site.recordingIds];
      recordingIds.splice(targetIndex, 0, recordingId);
      return { ...site, recordingIds };
    }),
  };
}

function reorderRecording(
  state: StudyState,
  siteId: string,
  recordingId: string,
  direction: -1 | 1,
): StudyState {
  return {
    ...state,
    sites: state.sites.map((site) => {
      if (site.id !== siteId) return site;
      const currentIndex = site.recordingIds.indexOf(recordingId);
      if (currentIndex === -1)
        throw new Error("The recording is not placed in this site.");
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= site.recordingIds.length)
        return site;
      const recordingIds = [...site.recordingIds];
      [recordingIds[currentIndex], recordingIds[targetIndex]] = [
        recordingIds[targetIndex],
        recordingIds[currentIndex],
      ];
      return { ...site, recordingIds };
    }),
  };
}

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
      return stamp(regressReadyProject({ ...state, recordings }));
    }
    case "recording/remove": {
      const withoutPlacement = removeRecordingFromSites(
        state,
        action.recordingId,
      );
      return stamp(
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
      return stamp(
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
      return stamp(
        regressReadyProject(
          removeRecordingFromSites(state, action.recordingId),
        ),
      );
    case "placement/reorder":
      return stamp(
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
      return stamp(
        regressReadyProject({
          ...state,
          issues: [action.issue, ...state.issues],
        }),
      );
    case "issue/transition":
      return stamp(
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
      return stamp({ ...state, preferences: action.preferences });
    case "project/readiness":
      return stamp({
        ...state,
        project: {
          ...state.project,
          stage: action.ready ? "ready" : "review",
          lastReadinessCheck: action.checkedAt,
        },
      });
    case "workspace/reset":
      return action.state;
    default:
      return state;
  }
}
