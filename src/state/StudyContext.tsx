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
  validateAssignmentDraft,
  validateMemberDraft,
} from "../domain/scheduleValidation";
import type {
  AssignmentDraft,
  MemberDraft,
  Recording,
  RecordingDraft,
  IssueDraft,
  IssueStatus,
  RoutePreferences,
  ReleaseResult,
  ScheduleAssignment,
  Snapshot,
  StudyState,
  TeamMember,
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
  setScheduleWeekend: (weekendStart: string, weekendEnd: string) => CommandResult;
  upsertMember: (
    draft: MemberDraft,
    existing?: TeamMember,
  ) => CommandResult<TeamMember>;
  removeMember: (memberId: string) => CommandResult;
  upsertAssignment: (
    draft: AssignmentDraft,
    existing?: ScheduleAssignment,
  ) => CommandResult<ScheduleAssignment>;
  removeAssignment: (assignmentId: string) => CommandResult;
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

  const setScheduleWeekend = useCallback(
    (weekendStart: string, weekendEnd: string): CommandResult => {
      if (!weekendStart || !weekendEnd)
        return {
          ok: false,
          message: "Choose both the start and end day.",
        };
      if (weekendEnd < weekendStart)
        return {
          ok: false,
          message: "The weekend cannot end before it starts.",
        };
      dispatch(
        withCommandMeta({
          type: "schedule/setWeekend",
          weekendStart,
          weekendEnd,
        }),
      );
      return { ok: true };
    },
    [withCommandMeta],
  );

  const upsertMember = useCallback(
    (draft: MemberDraft, existing?: TeamMember): CommandResult<TeamMember> => {
      const validation = validateMemberDraft(
        draft,
        state.schedule.members,
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
      const now = new Date().toISOString();
      const member: TeamMember = existing
        ? {
            ...existing,
            name: draft.name.trim(),
            role: draft.role.trim(),
            availableDates: draft.availableDates,
            updatedAt: now,
          }
        : {
            id: createId("member"),
            name: draft.name.trim(),
            role: draft.role.trim(),
            availableDates: draft.availableDates,
            createdAt: now,
            updatedAt: now,
          };
      dispatch(withCommandMeta({ type: "schedule/memberUpsert", member }));
      return { ok: true, value: member };
    },
    [state.schedule.members, withCommandMeta],
  );

  const removeMember = useCallback(
    (memberId: string): CommandResult => {
      const member = state.schedule.members.find(
        (candidate) => candidate.id === memberId,
      );
      if (!member)
        return { ok: false, message: "The selected colleague no longer exists." };
      dispatch(withCommandMeta({ type: "schedule/memberRemove", memberId }));
      return { ok: true };
    },
    [state.schedule.members, withCommandMeta],
  );

  const upsertAssignment = useCallback(
    (
      draft: AssignmentDraft,
      existing?: ScheduleAssignment,
    ): CommandResult<ScheduleAssignment> => {
      const validation = validateAssignmentDraft(
        draft,
        state.schedule,
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
      const now = new Date().toISOString();
      const assignment: ScheduleAssignment = existing
        ? {
            ...existing,
            memberId: draft.memberId,
            siteId: draft.siteId,
            date: draft.date,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            note: draft.note.trim() || undefined,
            updatedAt: now,
          }
        : {
            id: createId("assign"),
            memberId: draft.memberId,
            siteId: draft.siteId,
            date: draft.date,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            note: draft.note.trim() || undefined,
            createdAt: now,
            updatedAt: now,
          };
      dispatch(
        withCommandMeta({ type: "schedule/assignmentUpsert", assignment }),
      );
      return { ok: true, value: assignment };
    },
    [state.schedule, withCommandMeta],
  );

  const removeAssignment = useCallback(
    (assignmentId: string): CommandResult => {
      const assignment = state.schedule.assignments.find(
        (candidate) => candidate.id === assignmentId,
      );
      if (!assignment)
        return { ok: false, message: "The selected shift no longer exists." };
      dispatch(
        withCommandMeta({ type: "schedule/assignmentRemove", assignmentId }),
      );
      return { ok: true };
    },
    [state.schedule.assignments, withCommandMeta],
  );

  const checkReadiness = useCallback(() => {
    const analysis = analyzeRoute(state.recordings, state.sites);
    const result = evaluateRelease(state, analysis);
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
      setScheduleWeekend,
      upsertMember,
      removeMember,
      upsertAssignment,
      removeAssignment,
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
      setScheduleWeekend,
      upsertMember,
      removeMember,
      upsertAssignment,
      removeAssignment,
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
