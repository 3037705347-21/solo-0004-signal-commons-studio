import type {
  ImportBatch,
  Recording,
  IssueStatus,
  ReleaseRecord,
  RoutePreferences,
  QualityIssue,
  StudyState,
} from "../domain/models";

export interface CommandMeta {
  commandId: string;
  expectedRevision: number;
  originId: string;
  issuedAt: string;
}

export type RetentionTarget = "recording" | "site" | "issue" | "import-batch";

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
  | { type: "project/readiness"; release: ReleaseRecord }
  | { type: "import-batch/create"; batch: ImportBatch }
  | {
      type: "retention/archive";
      target: RetentionTarget;
      id: string;
      at?: Date;
    }
  | {
      type: "retention/restore";
      target: RetentionTarget;
      id: string;
      at?: Date;
    }
  | {
      type: "retention/purge";
      target: Exclude<RetentionTarget, "import-batch">;
      id: string;
      at?: Date;
    }
  | { type: "retention/sweep"; at?: Date }
  | { type: "workspace/reset"; state: StudyState }
  | { type: "workspace/sync"; state: StudyState };

export type StudyAction = StudyActionPayload & { meta?: CommandMeta };
