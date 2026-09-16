import type {
  Recording,
  IssueStatus,
  PendingRuleChange,
  ReleaseRecord,
  RoutePreferences,
  QualityIssue,
  RuleSet,
  StudyState,
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
  | {
      type: "rules/propose";
      label: string;
      note: string;
      rules: RuleSet;
    }
  | { type: "rules/adopt"; change: PendingRuleChange }
  | { type: "rules/discard" }
  | { type: "project/readiness"; release: ReleaseRecord }
  | { type: "workspace/reset"; state: StudyState }
  | { type: "workspace/sync"; state: StudyState };

export type StudyAction = StudyActionPayload & { meta?: CommandMeta };
