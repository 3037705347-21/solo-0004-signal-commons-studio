import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { createId } from "../domain/ids";
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
import { workspaceReducer } from "./reducer";
import { loadStudy } from "./persistence";
import {
  createCommandMeta,
  planAddIssue,
  planAssignRecording,
  planReadinessCheck,
  planRemovePlacement,
  planRemoveRecording,
  planReorderRecording,
  planSnapshotExport,
  planTransitionIssue,
  planUpdatePreferences,
  planUpsertRecording,
  planWorkspaceReset,
  withCommandMeta,
  type CommandPlan,
  type CommandResult,
} from "./commands";
import {
  useCrossTabWorkspaceSync,
  usePersistentWorkspace,
} from "./workspaceSync";
import type { StudyAction } from "./actions";

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
  resetStudy: () => void;
}

const StudyContext = createContext<StudyContextValue | null>(null);

/**
 * React binding for the workspace: owns the reducer state, wires persistence
 * and cross-tab sync, and exposes the typed commands planned in
 * `state/commands`. Business rules live in the planners and the domain layer,
 * not in these callbacks.
 */
export function StudyProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    loadStudy(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const originId = useRef(createId("tab")).current;
  const storageHealthy = usePersistentWorkspace(state);
  useCrossTabWorkspaceSync(stateRef, dispatch);

  const withMeta = useCallback(
    (action: StudyAction): StudyAction =>
      withCommandMeta(action, createCommandMeta(state.revision, originId)),
    [originId, state.revision],
  );

  const runPlan = useCallback(
    <T,>(plan: CommandPlan<T>): CommandResult<T> => {
      if (!plan.ok) return plan;
      dispatch(withMeta(plan.action));
      return plan.value === undefined
        ? { ok: true }
        : { ok: true, value: plan.value };
    },
    [withMeta],
  );

  const upsertRecording = useCallback(
    (draft: RecordingDraft, existing?: Recording): CommandResult<Recording> =>
      runPlan(planUpsertRecording(state, draft, existing)),
    [state, runPlan],
  );

  const removeRecording = useCallback(
    (recordingId: string): CommandResult =>
      runPlan(planRemoveRecording(state, recordingId)),
    [state, runPlan],
  );

  const assignRecording = useCallback(
    (recordingId: string, siteId: string): CommandResult =>
      runPlan(planAssignRecording(state, recordingId, siteId)),
    [state, runPlan],
  );

  const removePlacement = useCallback(
    (recordingId: string) => {
      runPlan(planRemovePlacement(recordingId));
    },
    [runPlan],
  );

  const reorderRecording = useCallback(
    (siteId: string, recordingId: string, direction: -1 | 1): CommandResult =>
      runPlan(planReorderRecording(state, siteId, recordingId, direction)),
    [state, runPlan],
  );

  const addIssue = useCallback(
    (draft: IssueDraft): CommandResult => runPlan(planAddIssue(draft)),
    [runPlan],
  );

  const transitionQualityIssue = useCallback(
    (issueId: string, status: IssueStatus): CommandResult =>
      runPlan(planTransitionIssue(state, issueId, status)),
    [state, runPlan],
  );

  const updatePreferences = useCallback(
    (preferences: RoutePreferences) => {
      runPlan(planUpdatePreferences(preferences));
    },
    [runPlan],
  );

  const checkReadiness = useCallback(() => {
    const { action, result } = planReadinessCheck(state);
    dispatch(withMeta(action));
    return result;
  }, [state, withMeta]);

  const createSnapshot = useCallback(
    (): CommandResult<Snapshot> => planSnapshotExport(state),
    [state],
  );

  const resetStudy = useCallback(() => {
    runPlan(planWorkspaceReset());
  }, [runPlan]);

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
