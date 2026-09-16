import type {
  Recording,
  IssueStatus,
  ReleaseRecord,
  RoutePreferences,
  QualityIssue,
  ScheduleAssignment,
  StudyState,
  TeamMember,
} from "../domain/models";

export interface CommandMeta {
  commandId: string;
  expectedRevision: number;
  originId: string;
  issuedAt: string;
}

type StudyActionPayload =
  | { type: "recording/upsert"; recording: Recording }
  | { type: "recording/remove"; recordingId: string }
  | {
      type: "placement/assign";
      recordingId: string;
      siteId: string;
      index?: number;
    }
  | { type: "placement/remove"; recordingId: string }
  | {
      type: "placement/reorder";
      siteId: string;
      recordingId: string;
      direction: -1 | 1;
    }
  | { type: "issue/add"; issue: QualityIssue }
  | {
      type: "issue/transition";
      issueId: string;
      status: IssueStatus;
      at?: Date;
    }
  | { type: "preferences/update"; preferences: RoutePreferences }
  | { type: "schedule/setWeekend"; weekendStart: string; weekendEnd: string }
  | { type: "schedule/memberUpsert"; member: TeamMember }
  | { type: "schedule/memberRemove"; memberId: string }
  | { type: "schedule/assignmentUpsert"; assignment: ScheduleAssignment }
  | { type: "schedule/assignmentRemove"; assignmentId: string }
  | { type: "project/readiness"; release: ReleaseRecord }
  | { type: "workspace/reset"; state: StudyState }
  | { type: "workspace/sync"; state: StudyState };

export type StudyAction = StudyActionPayload & { meta?: CommandMeta };
