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
import type {
  ConsentGrant,
  ConsentPurpose,
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
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";
import { createSeedStudy } from "./seed";
import type { CommandMeta, StudyAction } from "./actions";

interface CommandResult<T = undefined> {
  ok: boolean;
  value?: T;
  errors?: Record<string, string>;
  message?: string;
}

export interface ConsentInput {
  purposes: ConsentPurpose[];
  grantedBy: string;
  channel: string;
  evidenceRef: string;
  note: string;
  grantedAt: string;
  expiresAt?: string;
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
  recordConsent: (
    recordingId: string,
    input: ConsentInput,
  ) => CommandResult<ConsentGrant>;
  restrictConsent: (
    recordingId: string,
    input: ConsentInput,
  ) => CommandResult<ConsentGrant>;
  withdrawConsent: (
    recordingId: string,
    input: Pick<ConsentInput, "grantedBy" | "channel" | "evidenceRef" | "note">,
  ) => CommandResult<ConsentGrant>;
  updatePreferences: (preferences: RoutePreferences) => void;
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

  const validateConsentInput = useCallback(
    (
      recordingId: string,
      input: Pick<
        ConsentInput,
        "grantedBy" | "channel" | "evidenceRef" | "note"
      > & { purposes?: ConsentPurpose[] },
      requirePurposes = true,
    ): Record<string, string> => {
      const errors: Record<string, string> = {};
      if (!state.recordings.some((recording) => recording.id === recordingId))
        errors.recording = "Select a clip for this consent decision.";
      if (!input.grantedBy.trim())
        errors.grantedBy = "Name who granted or withdrew consent.";
      if (!input.channel.trim())
        errors.channel = "Record how the decision was captured.";
      if (!input.evidenceRef.trim())
        errors.evidenceRef = "Reference the evidence (form, email, or note).";
      if (
        requirePurposes &&
        (!input.purposes || input.purposes.length === 0)
      )
        errors.purposes = "Choose at least one authorized purpose.";
      return errors;
    },
    [state.recordings],
  );

  const buildGrant = useCallback(
    (
      actionType:
        | "consent/grant"
        | "consent/restrict"
        | "consent/withdraw",
      recordingId: string,
      input: ConsentInput,
    ): ConsentGrant => {
      const now = new Date().toISOString();
      const status =
        actionType === "consent/grant"
          ? "active"
          : actionType === "consent/restrict"
            ? "restricted"
            : "withdrawn";
      return {
        id: createId("grant"),
        recordingId,
        status,
        purposes:
          actionType === "consent/withdraw" ? [] : input.purposes,
        grantedBy: input.grantedBy.trim(),
        channel: input.channel.trim(),
        evidenceRef: input.evidenceRef.trim(),
        note: input.note.trim(),
        grantedAt: input.grantedAt || now.slice(0, 10),
        expiresAt: input.expiresAt?.trim() || undefined,
        createdAt: now,
      };
    },
    [],
  );

  const recordConsent = useCallback(
    (recordingId: string, input: ConsentInput): CommandResult<ConsentGrant> => {
      const errors = validateConsentInput(recordingId, input);
      if (Object.keys(errors).length)
        return {
          ok: false,
          errors,
          message: "Review the consent details before saving.",
        };
      const grant = buildGrant("consent/grant", recordingId, input);
      dispatch(withCommandMeta({ type: "consent/grant", grant }));
      return { ok: true, value: grant };
    },
    [buildGrant, validateConsentInput, withCommandMeta],
  );

  const restrictConsent = useCallback(
    (recordingId: string, input: ConsentInput): CommandResult<ConsentGrant> => {
      const errors = validateConsentInput(recordingId, input);
      if (Object.keys(errors).length)
        return {
          ok: false,
          errors,
          message: "Review the restricted scope before saving.",
        };
      const grant = buildGrant("consent/restrict", recordingId, input);
      dispatch(withCommandMeta({ type: "consent/restrict", grant }));
      return { ok: true, value: grant };
    },
    [buildGrant, validateConsentInput, withCommandMeta],
  );

  const withdrawConsent = useCallback(
    (
      recordingId: string,
      input: Pick<
        ConsentInput,
        "grantedBy" | "channel" | "evidenceRef" | "note"
      >,
    ): CommandResult<ConsentGrant> => {
      const errors = validateConsentInput(recordingId, input, false);
      if (Object.keys(errors).length)
        return {
          ok: false,
          errors,
          message: "Record who withdrew consent and the evidence.",
        };
      const grant = buildGrant("consent/withdraw", recordingId, {
        ...input,
        purposes: [],
        grantedAt: new Date().toISOString().slice(0, 10),
      });
      dispatch(withCommandMeta({ type: "consent/withdraw", grant }));
      return { ok: true, value: grant };
    },
    [buildGrant, validateConsentInput, withCommandMeta],
  );

  const checkReadiness = useCallback(() => {
    const now = new Date();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      state.consents,
      now,
    );
    const result = evaluateRelease(state, analysis, now);
    dispatch(
      withCommandMeta({
        type: "project/readiness",
        release: createReleaseRecord(state, analysis, result, now),
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
      recordConsent,
      restrictConsent,
      withdrawConsent,
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
      recordConsent,
      restrictConsent,
      withdrawConsent,
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
