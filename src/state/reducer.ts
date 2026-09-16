import { createId } from "../domain/ids";
import { canPlaceRecording } from "../domain/routeAnalysis";
import { compactLog, makeLogEntry } from "../domain/studyLog";
import {
  regressReadyProject,
  transitionIssue,
  transitionProject,
} from "../domain/transitions";
import {
  archiveImportBatch,
  archiveIssue,
  archiveRecording,
  archiveSite,
  purgeIssue,
  purgeRecording,
  purgeSite,
  requalify,
  restoreImportBatch,
  restoreIssue,
  restoreRecording,
  restoreSite,
  runRetentionSweep,
  RetentionError,
} from "../domain/retentionLifecycle";
import type { StudyState } from "../domain/models";
import type { RetentionTarget, StudyAction } from "./actions";

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
    release: { ...state.release, status: "stale" },
  };
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
      const recording =
        exists || action.recording.lifecycle
          ? action.recording
          : {
              ...action.recording,
              importBatchId: action.recording.importBatchId ?? "batch-manual-entry",
              lifecycle: {
                category: "active-recording" as const,
                state: "within-retention" as const,
                anchor: action.recording.createdAt,
              },
            };
      const importBatches =
        !exists &&
        !state.importBatches.some(
          (batch) => batch.id === (recording.importBatchId ?? "batch-manual-entry"),
        )
          ? [
              ...state.importBatches,
              {
                id: "batch-manual-entry",
                label: "Manual library entries",
                source: "Created directly in the workspace",
                importedAt: recording.createdAt,
                recordingIds: [recording.id],
              },
            ]
          : state.importBatches.map((batch) =>
              !exists && batch.id === recording.importBatchId
                ? { ...batch, recordingIds: [...batch.recordingIds, recording.id] }
                : batch,
            );
      const recordings = exists
        ? state.recordings.map((item) =>
            item.id === recording.id ? recording : item,
          )
        : [...state.recordings, recording];
      return mutate(
        state,
        action,
        regressReadyProject({ ...state, recordings, importBatches }),
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
      // A newly frozen release supersedes its predecessor; keep the prior
      // version (with its snapshot) in the lineage so old citations resolve.
      const releaseHistory = [...(staged.releaseHistory ?? [])];
      if (
        staged.release &&
        action.release.readiness.ready &&
        staged.release.id !== action.release.id
      ) {
        releaseHistory.push(staged.release);
      }
      return finalizeAction(
        {
          ...staged,
          project: {
            ...staged.project,
            lastReadinessCheck: action.release.readiness.checkedAt,
          },
          release: action.release,
          releaseHistory,
        },
        action,
        state.revision,
      );
    }
    case "import-batch/create": {
      if (
        state.importBatches.some((batch) => batch.id === action.batch.id)
      )
        return state;
      return mutate(
        state,
        action,
        {
          ...state,
          importBatches: [...state.importBatches, action.batch],
        },
      );
    }
    case "retention/archive":
      return applyRetention(state, action, (current, id, at) =>
        archiveLifecycle(current, action.target, id, at),
      );
    case "retention/restore":
      return applyRetention(state, action, (current, id, at) =>
        restoreLifecycle(current, action.target, id, at),
      );
    case "retention/purge":
      return applyRetention(state, action, (current, id, at) =>
        purgeLifecycle(current, action.target, id, at),
      );
    case "retention/sweep": {
      const disposition = commandDisposition(state, action);
      if (disposition === "duplicate") return state;
      if (disposition === "conflict") return rejectCommand(state, action);
      const result = runRetentionSweep(state, action.at ?? new Date());
      const changedCount =
        result.archivedRecordings +
        result.archivedSites +
        result.archivedIssues +
        result.purgedRecordings +
        result.purgedSites +
        result.purgedIssues;
      if (changedCount === 0) {
        // Nothing changed: do not bump the revision.
        return state;
      }
      return finalizeAction(
        invalidateRelease(regressReadyProject(result.state)),
        action,
        state.revision + 1,
        action.at,
      );
    }
    case "workspace/reset":
      return action.state;
    case "workspace/sync":
      return action.state;
    default:
      return state;
  }
}

function applyRetention(
  state: StudyState,
  action: Extract<
    StudyAction,
    { type: "retention/archive" | "retention/restore" | "retention/purge" }
  >,
  apply: (state: StudyState, id: string, at: Date) => StudyState,
): StudyState {
  const disposition = commandDisposition(state, action);
  if (disposition === "duplicate") return state;
  if (disposition === "conflict") return rejectCommand(state, action);
  try {
    const next = apply(state, action.id, action.at ?? new Date());
    if (next === state) return state;
    // Lifecycle moves invalidate the frozen release; restore additionally
    // regresses a ready project so qualification must be earned again.
    const regressed =
      action.type === "retention/restore"
        ? requalify(next)
        : regressReadyProject(next);
    return finalizeAction(
      invalidateRelease(regressed),
      action,
      state.revision + 1,
      action.at,
    );
  } catch (error) {
    if (error instanceof RetentionError) {
      // Domain guard refused the lifecycle move; record a rejected command.
      return rejectCommand(state, action, action.at);
    }
    throw error;
  }
}

function archiveLifecycle(
  state: StudyState,
  target: RetentionTarget,
  id: string,
  at: Date,
): StudyState {
  switch (target) {
    case "recording":
      return archiveRecording(state, id, at);
    case "site":
      return archiveSite(state, id, at);
    case "issue":
      return archiveIssue(state, id, at);
    case "import-batch":
      return archiveImportBatch(state, id, at);
  }
}

function restoreLifecycle(
  state: StudyState,
  target: RetentionTarget,
  id: string,
  at: Date,
): StudyState {
  switch (target) {
    case "recording":
      return restoreRecording(state, id, at);
    case "site":
      return restoreSite(state, id, at);
    case "issue":
      return restoreIssue(state, id, at);
    case "import-batch":
      return restoreImportBatch(state, id, at);
  }
}

function purgeLifecycle(
  state: StudyState,
  target: Exclude<RetentionTarget, "import-batch">,
  id: string,
  at: Date,
): StudyState {
  switch (target) {
    case "recording":
      return purgeRecording(state, id, at);
    case "site":
      return purgeSite(state, id, at);
    case "issue":
      return purgeIssue(state, id, at);
  }
}
