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
  captureBaseline,
  createHandoffPacket,
  effectiveReleaseState,
  guardMutation,
} from "../domain/handoff";
import {
  createReleaseRecord,
  evaluateRelease,
  isReleaseCurrent,
} from "../domain/releaseRules";
import type {
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RoutePreferences,
  ReleaseResult,
  Snapshot,
  StudyState,
  HandoffPacket,
} from "../domain/models";
import { workspaceReducer } from "./reducer";
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, HandoffOpenItemInput, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

export interface HandoffDraftInput {
  outgoingName: string;
  outgoingRole: string;
  incomingName: string;
  note: string;
  openItems: HandoffOpenItemInput[];
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
  removePlacement: (recordingId: string) => CommandResult;
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
  beginHandoff: () => CommandResult;
  createHandoff: (draft: HandoffDraftInput) => CommandResult<HandoffPacket>;
  decideHandoff: (
    handoffId: string,
    decision: "accepted" | "declined",
    receiverName: string,
    receiverNote: string,
  ) => CommandResult;
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
      if (existing) {
        const guard = guardMutation(state, { recordingId: existing.id });
        if (guard.blocked) return { ok: false, message: guard.reason };
      }
      const recording = recordingFromDraft(draft, existing);
      dispatch(withCommandMeta({ type: "recording/upsert", recording }));
      return { ok: true, value: recording };
    },
    [state.recordings, state.handoffs, withCommandMeta],
  );

  const removeRecording = useCallback(
    (recordingId: string): CommandResult => {
      const recording = state.recordings.find(
        (candidate) => candidate.id === recordingId,
      );
      if (!recording)
        return { ok: false, message: "The selected clip no longer exists." };
      const guard = guardMutation(state, { recordingId });
      if (guard.blocked) return { ok: false, message: guard.reason };
      dispatch(withCommandMeta({ type: "recording/remove", recordingId }));
      return { ok: true };
    },
    [state.recordings, state.handoffs, withCommandMeta],
  );

  const assignRecording = useCallback(
    (recordingId: string, siteId: string): CommandResult => {
      const guard = guardMutation(state, { recordingId, siteId });
      if (guard.blocked) return { ok: false, message: guard.reason };
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
    [state.handoffs, withCommandMeta],
  );

  const removePlacement = useCallback(
    (recordingId: string): CommandResult => {
      const site = state.sites.find((candidate) =>
        candidate.recordingIds.includes(recordingId),
      );
      const guard = guardMutation(state, {
        recordingId,
        siteId: site?.id,
      });
      if (guard.blocked) return { ok: false, message: guard.reason };
      dispatch(withCommandMeta({ type: "placement/remove", recordingId }));
      return { ok: true };
    },
    [state.sites, state.handoffs, withCommandMeta],
  );

  const reorderRecording = useCallback(
    (siteId: string, recordingId: string, direction: -1 | 1): CommandResult => {
      const guard = guardMutation(state, { recordingId, siteId });
      if (guard.blocked) return { ok: false, message: guard.reason };
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
    [state.handoffs, withCommandMeta],
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
      const guard = guardMutation(state, {
        recordingId: issue.recordingId,
        siteId: issue.siteId,
      });
      if (guard.blocked) return { ok: false, message: guard.reason };
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
    [state.issues, state.handoffs, withCommandMeta],
  );

  const updatePreferences = useCallback((preferences: RoutePreferences) => {
    dispatch(withCommandMeta({ type: "preferences/update", preferences }));
  }, [withCommandMeta]);

  const checkReadiness = useCallback(() => {
    const effective = effectiveReleaseState(state);
    const analysis = analyzeRoute(
      effective.recordings,
      effective.sites,
    );
    const result = evaluateRelease(state, analysis);
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(effective, analysis, result),
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

  const beginHandoff = useCallback((): CommandResult => {
    if (state.handoffs.some((handoff) => handoff.status === "pending"))
      return {
        ok: false,
        message:
          "Resolve the pending handoff before starting a new offline session.",
      };
    try {
      dispatch(
        withCommandMeta({
          type: "handoff/begin",
          baseline: captureBaseline(state),
        }),
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not start.",
      };
    }
  }, [state, withCommandMeta]);

  const createHandoff = useCallback(
    (draft: HandoffDraftInput): CommandResult<HandoffPacket> => {
      if (!draft.outgoingName.trim())
        return { ok: false, errors: { outgoingName: "Sign the handoff." } };
      if (!draft.incomingName.trim())
        return {
          ok: false,
          errors: { incomingName: "Name the receiving colleague." },
        };
      const pending = state.handoffs.find(
        (handoff) => handoff.status === "pending",
      );
      if (pending)
        return {
          ok: false,
          message: "A handoff packet is already waiting for confirmation.",
        };
      const baseline = state.activeBaseline ?? captureBaseline(state);
      const openItems = draft.openItems
        .filter((item) => item.title.trim())
        .map((item) => ({
          id: createId("handover"),
          title: item.title.trim(),
          detail: item.detail.trim(),
          severity: item.severity,
          status: "pending" as const,
          recordingId: item.recordingId || undefined,
          siteId: item.siteId || undefined,
          createdAt: new Date().toISOString(),
        }));
      const { packet, recordings, issues } = createHandoffPacket(
        state,
        baseline,
        { ...draft, openItems },
      );
      dispatch(
        withCommandMeta({
          type: "handoff/create",
          packet,
          recordings,
          issues,
        }),
      );
      return { ok: true, value: packet };
    },
    [state, withCommandMeta],
  );

  const decideHandoff = useCallback(
    (
      handoffId: string,
      decision: "accepted" | "declined",
      receiverName: string,
      receiverNote: string,
    ): CommandResult => {
      if (!receiverName.trim())
        return { ok: false, errors: { receiverName: "Sign to confirm." } };
      const packet = state.handoffs.find(
        (candidate) => candidate.id === handoffId,
      );
      if (!packet)
        return { ok: false, message: "This handoff no longer exists." };
      if (packet.status !== "pending")
        return { ok: false, message: "This handoff was already decided." };
      try {
        dispatch(
          withCommandMeta({
            type: "handoff/decide",
            handoffId,
            decision,
            receiverName,
            receiverNote,
          }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Decision failed.",
        };
      }
    },
    [state.handoffs, withCommandMeta],
  );

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
      checkReadiness,
      createSnapshot,
      beginHandoff,
      createHandoff,
      decideHandoff,
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
      beginHandoff,
      createHandoff,
      decideHandoff,
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
