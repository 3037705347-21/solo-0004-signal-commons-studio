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
} from "../domain/releaseRules";
import {
  selectActiveRuleVersion,
  validateRuleChange,
} from "../domain/rules";
import type {
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  PendingRuleChange,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
} from "../domain/models";
import { workspaceReducer } from "./reducer";
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
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
  proposeRuleChange: (
    draft: Pick<PendingRuleChange, "label" | "note" | "rules">,
  ) => CommandResult;
  adoptRuleChange: (change?: PendingRuleChange) => CommandResult;
  discardRuleChange: () => void;
  checkReadiness: () => ReleaseResult;
  createSnapshot: () => CommandResult<Snapshot>;
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
        selectActiveRuleVersion(state).rules,
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

  const proposeRuleChange = useCallback(
    (draft: Pick<PendingRuleChange, "label" | "note" | "rules">): CommandResult => {
      const validation = validateRuleChange(draft);
      if (validation.length) {
        return {
          ok: false,
          errors: Object.fromEntries(
            validation.map((error) => [error.field, error.message]),
          ),
          message: "Review the highlighted thresholds before saving.",
        };
      }
      dispatch(
        withCommandMeta({
          type: "rules/propose",
          label: draft.label,
          note: draft.note,
          rules: draft.rules,
        }),
      );
      return { ok: true };
    },
    [withCommandMeta],
  );

  const adoptRuleChange = useCallback(
    (change?: PendingRuleChange): CommandResult => {
      const pending = change ?? stateRef.current.pendingRuleChange;
      if (!pending)
        return { ok: false, message: "There is no draft adjustment to adopt." };
      const validation = validateRuleChange(pending);
      if (validation.length)
        return {
          ok: false,
          message: "The draft thresholds are no longer valid.",
        };
      dispatch(withCommandMeta({ type: "rules/adopt", change: pending }));
      return { ok: true };
    },
    [withCommandMeta],
  );

  const discardRuleChange = useCallback(() => {
    if (!stateRef.current.pendingRuleChange) return;
    dispatch(withCommandMeta({ type: "rules/discard" }));
  }, [withCommandMeta]);

  const checkReadiness = useCallback(() => {
    const ruleVersion = selectActiveRuleVersion(state);
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      ruleVersion.rules,
    );
    const result = evaluateRelease(state, analysis, new Date(), ruleVersion.rules);
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(state, analysis, result, ruleVersion),
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
      proposeRuleChange,
      adoptRuleChange,
      discardRuleChange,
      checkReadiness,
      createSnapshot,
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
      proposeRuleChange,
      adoptRuleChange,
      discardRuleChange,
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
