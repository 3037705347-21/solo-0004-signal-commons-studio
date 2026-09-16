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
import { createConflictDraft } from "../domain/conflictResolution";
import { createId } from "../domain/ids";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
  isReleaseCurrent,
} from "../domain/releaseRules";
import type {
  ConflictDraft,
  ConflictRecord,
  ConflictResolutionMode,
  MergeChoice,
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
} from "../domain/models";
import { workspaceReducer } from "./reducer";
import {
  commitWorkspace,
  loadDrafts,
  loadStudy,
  loadConflicts,
  pruneResolvedConflicts,
  saveDrafts,
  saveConflicts,
  STORAGE_KEY,
  CONFLICTS_KEY,
  DRAFTS_KEY,
} from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

interface ConflictNotice {
  tone: "conflict-detected" | "conflict-resolved";
  message: string;
  at: number;
}

interface StudyContextValue {
  state: StudyState;
  storageHealthy: boolean;
  conflicts: ConflictRecord[];
  drafts: ConflictDraft[];
  activeConflict: ConflictRecord | null;
  conflictNotice: ConflictNotice | null;
  openConflict: (conflictId: string) => void;
  closeConflict: () => void;
  resolveConflict: (
    conflict: ConflictRecord,
    mode: ConflictResolutionMode,
    mergeChoices?: Record<string, MergeChoice>,
  ) => void;
  resumeDraft: (draft: ConflictDraft) => void;
  discardDraft: (draftId: string) => void;
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
  resetStudy: () => void;
}

const StudyContext = createContext<StudyContextValue | null>(null);

function signatureOf(state: StudyState): string {
  return `${state.revision}|${state.updatedAt}`;
}

export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    loadStudy(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const baseRef = useRef<StudyState>(state);
  const originId = useRef(createId("tab")).current;
  const committedSigRef = useRef<string | null>(signatureOf(state));
  const resolutionBookkeepingRef = useRef<{
    removeConflictId: string;
    addDraft?: ConflictDraft;
  } | null>(null);
  const [storageHealthy, setStorageHealthy] = useState(true);
  // The workspace document (with its resolution audit trail) is the durable
  // source of truth; on mount drop any conflict list a tab failed to prune
  // before its last unload, so a resolved conflict cannot survive a refresh.
  const [conflicts, setConflicts] = useState<ConflictRecord[]>(() => {
    const initial = pruneResolvedConflicts(loadConflicts(), state);
    if (initial.length < loadConflicts().length) saveConflicts(initial);
    return initial;
  });
  const [drafts, setDrafts] = useState<ConflictDraft[]>(() => loadDrafts());
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<ConflictNotice | null>(
    null,
  );

  const registerConflict = useCallback(
    (ours: StudyState, base: StudyState, committed: StudyState) => {
      const pending = loadConflicts();
      const duplicate = pending.find(
        (entry) =>
          entry.originId === originId &&
          signatureOf(entry.ours) === signatureOf(ours),
      );
      if (duplicate) {
        setActiveConflictId(duplicate.id);
        setConflicts(pending);
        return duplicate;
      }
      const commandSummary =
        ours.auditLog.find((entry) => entry.originId === originId)?.summary ??
        "Unsynchronized edit";
      const record: ConflictRecord = {
        id: createId("conflict"),
        detectedAt: new Date().toISOString(),
        originId,
        originLabel: "This tab",
        commandSummary,
        baseRevision: base.revision,
        oursRevision: ours.revision,
        theirsRevision: committed.revision,
        base,
        ours,
        theirs: committed,
      };
      const next = [...pending, record];
      saveConflicts(next);
      baseRef.current = committed;
      committedSigRef.current = signatureOf(committed);
      setConflicts(next);
      setActiveConflictId(record.id);
      dispatch({ type: "workspace/sync", state: committed });
      setConflictNotice({
        tone: "conflict-detected",
        message:
          "Another tab committed while you were editing. Choose how to combine the two versions.",
        at: Date.now(),
      });
      return record;
    },
    [originId],
  );

  // Persist every committed local state, but refuse to overwrite a primary
  // record that another tab committed in the meantime; surface that as a
  // conflict instead of silently dropping this tab's edit.
  useEffect(() => {
    const current = stateRef.current;
    const outcome = commitWorkspace(current, committedSigRef.current);
    if (outcome.status === "unavailable") {
      setStorageHealthy(false);
      return;
    }
    setStorageHealthy(true);
    if (outcome.status === "diverged") {
      const committed = outcome.committed;
      // Another tab already committed a resolution for the same conflict this
      // tab is now resolving. Do not re-open it: adopt the committed result and
      // prune the conflict instead of registering a duplicate.
      const alreadyResolvedHere = current.auditLog.some(
        (entry) =>
          entry.action === "conflict/resolve" &&
          typeof entry.conflictId === "string" &&
          committed.auditLog.some(
            (committedEntry) =>
              committedEntry.action === "conflict/resolve" &&
              committedEntry.conflictId === entry.conflictId,
          ),
      );
      if (alreadyResolvedHere) {
        committedSigRef.current = signatureOf(committed);
        baseRef.current = committed;
        const pendingBookkeeping = resolutionBookkeepingRef.current;
        resolutionBookkeepingRef.current = null;
        const remaining = pruneResolvedConflicts(loadConflicts(), committed);
        saveConflicts(remaining);
        if (pendingBookkeeping?.addDraft)
          saveDrafts([...loadDrafts(), pendingBookkeeping.addDraft]);
        setConflicts(remaining);
        setDrafts(
          pendingBookkeeping?.addDraft
            ? [...loadDrafts(), pendingBookkeeping.addDraft]
            : loadDrafts(),
        );
        setActiveConflictId(null);
        dispatch({ type: "workspace/sync", state: committed });
        return;
      }
      registerConflict(current, baseRef.current, committed);
      return;
    }
    if (outcome.status === "committed" || outcome.status === "identical") {
      committedSigRef.current = outcome.signature;
    }
    const bookkeeping = resolutionBookkeepingRef.current;
    if (bookkeeping && (outcome.status === "committed" || outcome.status === "identical")) {
      resolutionBookkeepingRef.current = null;
      const remaining = loadConflicts().filter(
        (entry) => entry.id !== bookkeeping.removeConflictId,
      );
      const nextDrafts = bookkeeping.addDraft
        ? [...loadDrafts(), bookkeeping.addDraft]
        : loadDrafts();
      saveConflicts(remaining);
      if (bookkeeping.addDraft) saveDrafts(nextDrafts);
      setConflicts(remaining);
      setDrafts(nextDrafts);
    }
  }, [state, registerConflict]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CONFLICTS_KEY) {
        setConflicts(pruneResolvedConflicts(loadConflicts(), stateRef.current));
        return;
      }
      if (event.key === DRAFTS_KEY) {
        setDrafts(loadDrafts());
        return;
      }
      if (event.key !== STORAGE_KEY) return;
      const incoming = loadStudy();
      const current = stateRef.current;
      if (
        incoming.revision < current.revision ||
        (incoming.revision === current.revision &&
          incoming.updatedAt === current.updatedAt)
      )
        return;
      const wasConflictResolution = incoming.auditLog.some(
        (entry) =>
          entry.action === "conflict/resolve" &&
          entry.originId !== originId &&
          entry.revision === incoming.revision,
      );
      committedSigRef.current = signatureOf(incoming);
      baseRef.current = incoming;
      dispatch({ type: "workspace/sync", state: incoming });
      // Prune conflicts resolved by the incoming commit before rebasing. The
      // resolving tab prunes the conflict list in a separate write that may
      // arrive after this workspace event; without this filter the rebase
      // below would re-save (and resurrect) a conflict the team just closed.
      const pending = pruneResolvedConflicts(loadConflicts(), incoming);
      const rebased = pending.map((conflict) =>
        incoming.revision >= conflict.theirsRevision
          ? { ...conflict, theirs: incoming, theirsRevision: incoming.revision }
          : conflict,
      );
      if (rebased.some((conflict, index) => conflict !== pending[index])) {
        saveConflicts(rebased);
      }
      setConflicts(rebased);
      if (wasConflictResolution) {
        setConflictNotice({
          tone: "conflict-resolved",
          message:
            "Another tab resolved an editing conflict; this view now shows the agreed version.",
          at: Date.now(),
        });
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [originId]);

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
      baseRef.current = stateRef.current;
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
      baseRef.current = stateRef.current;
      dispatch(withCommandMeta({ type: "recording/remove", recordingId }));
      return { ok: true };
    },
    [state.recordings, withCommandMeta],
  );

  const assignRecording = useCallback(
    (recordingId: string, siteId: string): CommandResult => {
      try {
        baseRef.current = stateRef.current;
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

  const removePlacement = useCallback(
    (recordingId: string) => {
      baseRef.current = stateRef.current;
      dispatch(withCommandMeta({ type: "placement/remove", recordingId }));
    },
    [withCommandMeta],
  );

  const reorderRecording = useCallback(
    (siteId: string, recordingId: string, direction: -1 | 1): CommandResult => {
      try {
        baseRef.current = stateRef.current;
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

  const addIssue = useCallback(
    (draft: IssueDraft): CommandResult => {
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
      baseRef.current = stateRef.current;
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
    },
    [withCommandMeta],
  );

  const transitionQualityIssue = useCallback(
    (issueId: string, status: IssueStatus): CommandResult => {
      const issue = state.issues.find((candidate) => candidate.id === issueId);
      if (!issue)
        return {
          ok: false,
          message: "The selected review finding no longer exists.",
        };
      try {
        baseRef.current = stateRef.current;
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

  const updatePreferences = useCallback(
    (preferences: RoutePreferences) => {
      baseRef.current = stateRef.current;
      dispatch(withCommandMeta({ type: "preferences/update", preferences }));
    },
    [withCommandMeta],
  );

  const checkReadiness = useCallback(() => {
    const analysis = analyzeRoute(state.recordings, state.sites);
    const result = evaluateRelease(state, analysis);
    baseRef.current = stateRef.current;
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(state, analysis, result),
      }),
    );
    return result;
  }, [state, withCommandMeta]);

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

  const resetStudy = useCallback(() => {
    baseRef.current = stateRef.current;
    dispatch(
      withCommandMeta({
        type: "workspace/reset",
        state: createSeedStudy(),
      }),
    );
    saveConflicts([]);
    setConflicts([]);
    setActiveConflictId(null);
  }, [withCommandMeta]);

  const openConflict = useCallback((conflictId: string) => {
    setActiveConflictId(conflictId);
  }, []);

  const closeConflict = useCallback(() => setActiveConflictId(null), []);

  const resolveConflict = useCallback(
    (
      conflict: ConflictRecord,
      mode: ConflictResolutionMode,
      mergeChoices?: Record<string, MergeChoice>,
    ) => {
      const draft =
        mode === "draft" ? createConflictDraft(conflict) : undefined;
      // Prune the conflict record (and park the draft, if chosen) only after
      // the resolved state commits successfully, via the persistence effect.
      resolutionBookkeepingRef.current = {
        removeConflictId: conflict.id,
        addDraft: draft,
      };
      dispatch(
        withCommandMeta({
          type: "conflict/resolve",
          conflict,
          mode,
          mergeChoices,
          draft,
        }),
      );
      setActiveConflictId(null);
    },
    [withCommandMeta],
  );

  const resumeDraft = useCallback(
    (draft: ConflictDraft) => {
      const pending = loadConflicts();
      const record: ConflictRecord = {
        id: createId("conflict"),
        detectedAt: new Date().toISOString(),
        originId: draft.originId,
        originLabel: "Resumed draft",
        commandSummary: draft.commandSummary,
        baseRevision: draft.baseRevision,
        oursRevision: draft.ours.revision,
        theirsRevision: draft.theirsRevision,
        base: draft.base,
        ours: draft.ours,
        theirs: stateRef.current,
      };
      const next = [...pending, record];
      saveConflicts(next);
      setConflicts(next);
      setActiveConflictId(record.id);
    },
    [],
  );

  const discardDraft = useCallback((draftId: string) => {
    const next = loadDrafts().filter((draft) => draft.id !== draftId);
    saveDrafts(next);
    setDrafts(next);
  }, []);

  const activeConflict =
    conflicts.find((entry) => entry.id === activeConflictId) ?? null;

  const value = useMemo<StudyContextValue>(
    () => ({
      state,
      storageHealthy,
      conflicts,
      drafts,
      activeConflict,
      conflictNotice,
      openConflict,
      closeConflict,
      resolveConflict,
      resumeDraft,
      discardDraft,
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
      resetStudy,
    }),
    [
      state,
      storageHealthy,
      conflicts,
      drafts,
      activeConflict,
      conflictNotice,
      openConflict,
      closeConflict,
      resolveConflict,
      resumeDraft,
      discardDraft,
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
