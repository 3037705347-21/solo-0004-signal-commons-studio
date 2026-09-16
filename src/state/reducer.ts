import { createId } from "../domain/ids";
import { canPlaceRecording } from "../domain/routeAnalysis";
import { compactLog, makeLogEntry } from "../domain/studyLog";
import {
  regressReadyProject,
  transitionIssue,
  transitionProject,
} from "../domain/transitions";
import type { StudyState } from "../domain/models";
import type { StudyAction } from "./actions";

const AUDIT_LOG_LIMIT = 80;

function commandDisposition(
  state: StudyState,
  action: StudyAction,
): "apply" | "duplicate" | "conflict" {
  const meta = action.meta;
  if (!meta) return "apply";
  if (
    state.auditLog.some(
      (entry) => entry.commandId === meta.commandId,
    )
  )
    return "duplicate";
  return meta.expectedRevision === state.revision ? "apply" : "conflict";
}

function finalizeAction(
  state: StudyState,
  action: StudyAction,
  revision: number,
  at = new Date(),
): StudyState {
  const timestamp = at.toISOString();
  const entry = makeLogEntry(
    action,
    createId("event"),
    revision,
    at,
  );
  return {
    ...state,
    revision,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
    auditLog: compactLog([...state.auditLog, entry], AUDIT_LOG_LIMIT),
  };
}

function rejectCommand(
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

function invalidateRelease(state: StudyState): StudyState {
  if (!state.release || state.release.status === "stale") return state;
  return {
    ...state,
    // Only the live head is marked stale; immutable history entries keep the
    // status they were evaluated with.
    release: { ...state.release, status: "stale" },
  };
}

function cloneContent<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Forks the frozen content of a historical version into a fresh review draft.
 * History is never rewritten, and the previously publishable head is marked
 * stale so the workspace cannot be mistaken for still being on that release.
 */
function forkDraftFromRelease(
  state: StudyState,
  releaseId: string,
): StudyState {
  const entry = state.releaseHistory.find(
    (candidate) => candidate.id === releaseId,
  );
  if (!entry?.content) {
    throw new Error("That release version is no longer available to restore.");
  }
  const content = entry.content;
  const forked: StudyState = {
    ...state,
    project: {
      ...state.project,
      title: content.project.title,
      fieldArea: content.project.fieldArea,
      listeningQuestion: content.project.listeningQuestion,
      publicationDate: content.project.publicationDate,
      stage: "review",
      lastReadinessCheck: undefined,
    },
    recordings: cloneContent(content.recordings),
    sites: cloneContent(content.sites),
    issues: cloneContent(content.issues),
    preferences: cloneContent(content.preferences),
    release:
      state.release && state.release.status !== "stale"
        ? { ...state.release, status: "stale" }
        : state.release,
    draftSourceReleaseId: entry.id,
  };
  return forked;
}

function mutate(
  state: StudyState,
  action: StudyAction,
  next: StudyState,
): StudyState {
  if (next === state) return state;
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  return finalizeAction(
    invalidateRelease(next),
    action,
    state.revision + 1,
  );
}

function applyReadinessStage(
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
  const targetSite = state.sites.find((site) => site.id === siteId);
  if (!targetSite) {
    throw new Error("Cannot place a recording in an unknown site.");
  }
  const recording = state.recordings.find(
    (candidate) => candidate.id === recordingId,
  );
  if (!recording) {
    throw new Error("Cannot place a clip that is not in the library.");
  }
  const recordingById = new Map(
    state.recordings.map((candidate) => [candidate.id, candidate]),
  );
  const currentClips = targetSite.recordingIds
    .filter((id) => id !== recordingId)
    .map((id) => recordingById.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );
  const [blocking] = canPlaceRecording(recording, targetSite, currentClips).filter(
    (finding) => finding.type === "error",
  );
  if (blocking) {
    throw new Error(blocking.detail);
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
      return mutate(
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
      return mutate(
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
      return mutate(
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
      return mutate(
        state,
        action,
        regressReadyProject(
          removeRecordingFromSites(state, action.recordingId),
        ),
      );
    case "placement/reorder":
      return mutate(
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
      return mutate(
        state,
        action,
        regressReadyProject({
          ...state,
          issues: [action.issue, ...state.issues],
        }),
      );
    case "issue/transition":
      return mutate(
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
      return mutate(
        state,
        action,
        regressReadyProject({ ...state, preferences: action.preferences }),
      );
    case "project/readiness": {
      const disposition = commandDisposition(state, action);
      if (disposition === "duplicate") return state;
      if (disposition === "conflict") return rejectCommand(state, action);
      const staged = applyReadinessStage(
        state,
        action.release.readiness.ready,
      );
      // Append-only lineage: the frozen record is shared by reference with the
      // live head but never edited after this point.
      const releaseHistory = [
        ...state.releaseHistory.filter(
          (entry) => entry.id !== action.release.id,
        ),
        action.release,
      ].sort((left, right) => left.sequence - right.sequence);
      return finalizeAction(
        {
          ...staged,
          project: {
            ...staged.project,
            lastReadinessCheck: action.release.readiness.checkedAt,
          },
          release: action.release,
          releaseHistory,
          draftSourceReleaseId: undefined,
        },
        action,
        state.revision,
      );
    }
    case "release/fork-draft": {
      const disposition = commandDisposition(state, action);
      if (disposition === "duplicate") return state;
      if (disposition === "conflict") return rejectCommand(state, action);
      const next = forkDraftFromRelease(state, action.releaseId);
      return finalizeAction(next, action, state.revision + 1);
    }
    case "workspace/reset":
      return action.state;
    case "workspace/sync":
      return action.state;
    default:
      return state;
  }
}
