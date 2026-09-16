import type {
  Recording,
  IssueStatus,
  ReleaseRecord,
  RoutePreferences,
  QualityIssue,
  StudyState,
  HandoffPacket,
  HandoffBaseline,
} from "../domain/models";

export interface CommandMeta {
  commandId: string;
  expectedRevision: number;
  originId: string;
  issuedAt: string;
}

export interface HandoffOpenItemInput {
  title: string;
  detail: string;
  severity: "critical" | "warning" | "note";
  recordingId?: string;
  siteId?: string;
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
  | { type: "project/readiness"; release: ReleaseRecord }
  | {
      type: "handoff/begin";
      baseline: HandoffBaseline;
    }
  | {
      type: "handoff/create";
      packet: HandoffPacket;
      recordings: Recording[];
      issues: QualityIssue[];
    }
  | {
      type: "handoff/decide";
      handoffId: string;
      decision: "accepted" | "declined";
      receiverName: string;
      receiverNote: string;
    }
  | { type: "handoff/withdraw"; handoffId: string }
  | {
      type: "handoff/item-decide";
      handoffId: string;
      itemId: string;
      status: "accepted" | "declined";
    }
  | { type: "workspace/reset"; state: StudyState }
  | { type: "workspace/sync"; state: StudyState };

export type StudyAction = StudyActionPayload & { meta?: CommandMeta };
