import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  recordingFromDraft,
  validateRecordingDraft,
} from "../domain/recordingValidation";
import { createId } from "../domain/ids";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
  isReleaseCurrent,
  liveRecordings,
  liveSites,
} from "../domain/releaseRules";
import type {
  ImportBatch,
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
} from "../domain/models";
import {
  canArchiveIssue,
  canArchiveRecording,
  canArchiveSite,
  canPurgeIssue,
  canPurgeRecording,
  canPurgeSite,
  runRetentionSweep as runRetentionSweepPure,
} from "../domain/retentionLifecycle";
import { workspaceReducer } from "./reducer";
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, RetentionTarget, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

interface RetentionCommandResult {
  ok: boolean;
  message?: string;
  changed?: boolean;
  counts?: {
    archivedRecordings: number;
    archivedSites: number;
    archivedIssues: number;
    purgedRecordings: number;
    purgedSites: number;
    purgedIssues: number;
    skipped: string[];
  };
}

interface StudyContextValue {
  state: StudyState;
  storageHealthy: boolean;
  upsertRecording: (
    draft: RecordingDraft,
    existing?: Recording,
  ) => CommandResult<Recording>;
  removeRecording: (recordingId: string) => CommandResult;
  assignRecording: (recordingId: string, siteId: string) => CommandResult;
  removePlacement: (recordingId: string) => void;
  reorderRecording: (
    siteId: string,
    recordingId: string,
    direction: -1 | 1,
  ) => CommandResult;
  addIssue: (draft: IssueDraft) => CommandResult;
  transitionQualityIssue: (
    issueId: string,
    status: IssueStatus,
  ) => CommandResult;
  updatePreferences: (preferences: RoutePreferences) => void;
  checkReadiness: () => ReleaseResult;
  createSnapshot: () => CommandResult<Snapshot>;
  archiveRecord: (target: RetentionTarget, id: string) => CommandResult;
  restoreRecord: (target: RetentionTarget, id: string) => CommandResult;
  purgeRecord: (
    target: Exclude<RetentionTarget, "import-batch">,
    id: string,
  ) => CommandResult;
  explainArchiveBlock: (target: RetentionTarget, id: string) => string | null;
  explainPurgeBlock: (
    target: Exclude<RetentionTarget, "import-batch">,
    id: string,
  ) => string | null;
  registerImportBatch: (input: {
    label: string;
    source: string;
    note?: string;
  }) => CommandResult<ImportBatch>;
  runRetentionSweep: () => RetentionCommandResult;
  resetStudy: () => void;
}

const StudyContext = createContext<StudyContextValue | null>(null);

export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    loadStudy(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const originId = useRef(createId("tab")).current;
  const [storageHealthy, setStorageHealthy] = useState(true);

  useEffect(() => {
    setStorageHealthy(saveStudy(state));
  }, [state]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const incoming = loadStudy();
      const current = stateRef.current;
      if (
        incoming.revision < current.revision ||
        (incoming.revision === current.revision &&
          incoming.updatedAt === current.updatedAt)
      )
        return;
      dispatch({ type: "workspace/sync", state: incoming });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const withCommandMeta = useCallback(
    (action: StudyAction): StudyAction => {
      const meta: CommandMeta = {
        commandId: createId("command"),
        expectedRevision: state.revision,
        originId,
        issuedAt: new Date().toISOString(),
      };
      return { ...action, meta };
    },
    [originId, state.revision],
  );

  const upsertRecording = useCallback(
    (draft: RecordingDraft, existing?: Recording): CommandResult<Recording> => {
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
      dispatch(withCommandMeta({ type: "recording/upsert", recording }));
      return { ok: true, value: recording };
    },
    [state.recordings, withCommandMeta],
  );

  const removeRecording = useCallback(
    (recordingId: string): CommandResult => {
      const recording = state.recordings.find(
        (candidate) => candidate.id === recordingId,
      );
      if (!recording)
        return { ok: false, message: "The selected clip no longer exists." };
      dispatch(withCommandMeta({ type: "recording/remove", recordingId }));
      return { ok: true };
    },
    [state.recordings, withCommandMeta],
  );

  const assignRecording = useCallback(
    (recordingId: string, siteId: string): CommandResult => {
      try {
        dispatch(
          withCommandMeta({ type: "placement/assign", recordingId, siteId }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Placement could not be updated.",
        };
      }
    },
    [withCommandMeta],
  );

  const removePlacement = useCallback((recordingId: string) => {
    dispatch(withCommandMeta({ type: "placement/remove", recordingId }));
  }, [withCommandMeta]);

  const reorderRecording = useCallback(
    (siteId: string, recordingId: string, direction: -1 | 1): CommandResult => {
      try {
        dispatch(
          withCommandMeta({
            type: "placement/reorder",
            siteId,
            recordingId,
            direction,
          }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Clip sequence could not be changed.",
        };
      }
    },
    [withCommandMeta],
  );

  const addIssue = useCallback((draft: IssueDraft): CommandResult => {
    if (!draft.title.trim())
      return { ok: false, errors: { title: "A finding title is required." } };
    if (draft.description.trim().length < 16)
      return {
        ok: false,
        errors: { description: "Add at least 16 characters of context." },
      };
    if (!draft.owner.trim())
      return { ok: false, errors: { owner: "Assign an owner." } };
    const now = new Date().toISOString();
    dispatch(
      withCommandMeta({
        type: "issue/add",
        issue: {
          id: createId("issue"),
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
      }),
    );
    return { ok: true };
  }, [withCommandMeta]);

  const transitionQualityIssue = useCallback(
    (issueId: string, status: IssueStatus): CommandResult => {
      const issue = state.issues.find((candidate) => candidate.id === issueId);
      if (!issue)
        return {
          ok: false,
          message: "The selected review finding no longer exists.",
        };
      try {
        dispatch(
          withCommandMeta({ type: "issue/transition", issueId, status }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Status could not be changed.",
        };
      }
    },
    [state.issues, withCommandMeta],
  );

  const updatePreferences = useCallback((preferences: RoutePreferences) => {
    dispatch(withCommandMeta({ type: "preferences/update", preferences }));
  }, [withCommandMeta]);

  const checkReadiness = useCallback(() => {
    const analysis = analyzeRoute(
      liveRecordings(stateRef.current),
      liveSites(stateRef.current),
    );
    const result = evaluateRelease(stateRef.current, analysis);
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(stateRef.current, analysis, result),
      }),
    );
    return result;
  }, [withCommandMeta]);

  const createSnapshot = useCallback((): CommandResult<Snapshot> => {
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
  }, [state]);

  const resetStudy = useCallback(
    () =>
      dispatch(
        withCommandMeta({
          type: "workspace/reset",
          state: createSeedStudy(),
        }),
      ),
    [withCommandMeta],
  );

  const explainArchiveBlock = useCallback(
    (target: RetentionTarget, id: string): string | null => {
      const current = stateRef.current;
      if (target === "recording") return canArchiveRecording(current, id);
      if (target === "site") return canArchiveSite(current, id);
      if (target === "issue") return canArchiveIssue(current, id);
      const batch = current.importBatches.find((item) => item.id === id);
      if (!batch) return "The selected import batch no longer exists.";
      return batch.archivedAt ? "This import batch is already archived." : null;
    },
    [],
  );

  const explainPurgeBlock = useCallback(
    (target: Exclude<RetentionTarget, "import-batch">, id: string) => {
      const current = stateRef.current;
      if (target === "recording") return canPurgeRecording(current, id);
      if (target === "site") return canPurgeSite(current, id);
      return canPurgeIssue(current, id);
    },
    [],
  );

  const archiveRecord = useCallback(
    (target: RetentionTarget, id: string): CommandResult => {
      const block = explainArchiveBlock(target, id);
      if (block) return { ok: false, message: block };
      dispatch(withCommandMeta({ type: "retention/archive", target, id }));
      return { ok: true };
    },
    [explainArchiveBlock, withCommandMeta],
  );

  const restoreRecord = useCallback(
    (target: RetentionTarget, id: string): CommandResult => {
      dispatch(withCommandMeta({ type: "retention/restore", target, id }));
      return { ok: true, message: "Restored. A fresh readiness check is required before release." };
    },
    [withCommandMeta],
  );

  const purgeRecord = useCallback(
    (target: Exclude<RetentionTarget, "import-batch">, id: string): CommandResult => {
      const block = explainPurgeBlock(target, id);
      if (block) return { ok: false, message: block };
      dispatch(withCommandMeta({ type: "retention/purge", target, id }));
      return { ok: true, message: "Record cleaned. Existing references remain resolvable." };
    },
    [explainPurgeBlock, withCommandMeta],
  );

  const registerImportBatch = useCallback(
    (input: {
      label: string;
      source: string;
      note?: string;
    }): CommandResult<ImportBatch> => {
      const label = input.label.trim();
      const source = input.source.trim();
      if (!label)
        return { ok: false, errors: { label: "A batch label is required." } };
      if (!source)
        return { ok: false, errors: { source: "A batch source is required." } };
      const batch: ImportBatch = {
        id: createId("batch"),
        label,
        source,
        importedAt: new Date().toISOString(),
        recordingIds: [],
        note: input.note?.trim() || undefined,
      };
      dispatch(withCommandMeta({ type: "import-batch/create", batch }));
      return { ok: true, value: batch };
    },
    [withCommandMeta],
  );

  const runRetentionSweep = useCallback((): RetentionCommandResult => {
    // Run the pure policy once to report counts immediately, then commit the
    // same result through the revision-guarded command path.
    const current = stateRef.current;
    const preview = runRetentionSweepPure(current);
    dispatch(withCommandMeta({ type: "retention/sweep" }));
    const total =
      preview.archivedRecordings +
      preview.archivedSites +
      preview.archivedIssues +
      preview.purgedRecordings +
      preview.purgedSites +
      preview.purgedIssues;
    return {
      ok: true,
      changed: total > 0,
      counts: {
        archivedRecordings: preview.archivedRecordings,
        archivedSites: preview.archivedSites,
        archivedIssues: preview.archivedIssues,
        purgedRecordings: preview.purgedRecordings,
        purgedSites: preview.purgedSites,
        purgedIssues: preview.purgedIssues,
        skipped: preview.skipped,
      },
      message: total
        ? `Retention sweep archived ${preview.archivedRecordings + preview.archivedSites + preview.archivedIssues} and cleaned ${preview.purgedRecordings + preview.purgedSites + preview.purgedIssues} records.`
        : "Nothing is due for archival in this sweep.",
    };
  }, [withCommandMeta]);

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      storageHealthy,
      upsertRecording,
      removeRecording,
      assignRecording,
      removePlacement,
      reorderRecording,
      addIssue,
      transitionQualityIssue,
      updatePreferences,
      checkReadiness,
      createSnapshot,
      archiveRecord,
      restoreRecord,
      purgeRecord,
      explainArchiveBlock,
      explainPurgeBlock,
      registerImportBatch,
      runRetentionSweep,
      resetStudy,
    }),
    [
      state,
      storageHealthy,
      upsertRecording,
      removeRecording,
      assignRecording,
      removePlacement,
      reorderRecording,
      addIssue,
      transitionQualityIssue,
      updatePreferences,
      checkReadiness,
      createSnapshot,
      archiveRecord,
      restoreRecord,
      purgeRecord,
      explainArchiveBlock,
      explainPurgeBlock,
      registerImportBatch,
      runRetentionSweep,
      resetStudy,
    ],
  );

  return (
    <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
  );
}

export function useStudy(): StudyContextValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error("useStudy must be used inside StudyProvider.");
  return value;
}
