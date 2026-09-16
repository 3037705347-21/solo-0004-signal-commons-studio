export type ProjectStage = "draft" | "review" | "ready";
export type SignalRole = "arrival" | "texture" | "voice" | "departure";
export type Sensitivity = "public" | "restricted" | "sensitive";
export type TranscriptStatus = "missing" | "draft" | "verified";
export type ConsentStatus = "pending" | "confirmed" | "restricted";
export type IssueSeverity = "note" | "warning" | "critical";
export type IssueStatus = "open" | "in-progress" | "resolved";

export interface AudioSpec {
  sampleRate: number;
  channels: 1 | 2;
  bitDepth: 16 | 24 | 32;
  durationSeconds: number;
}

export interface Recording {
  id: string;
  catalogId: string;
  title: string;
  source: string;
  recordedOn: string;
  format: string;
  location: string;
  summary: string;
  audioSpec: AudioSpec;
  signalRole: SignalRole;
  sensitivity: Sensitivity;
  transcriptStatus: TranscriptStatus;
  consentStatus: ConsentStatus;
  isFeatured: boolean;
  tags: string[];
  color: string;
  createdAt: string;
  updatedAt: string;
  /** Handoff packet this recording entered the study through; absent = pre-handoff baseline. */
  handoffId?: string;
}

export interface Site {
  id: string;
  name: string;
  shortLabel: string;
  prompt: string;
  maxDurationSeconds: number;
  maxClips: number;
  quietSpace: boolean;
  hasSeating: boolean;
  color: string;
  sequence: number;
  recordingIds: string[];
}

export interface QualityIssue {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  siteId?: string;
  recordingId?: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  /** Handoff packet this finding entered the study through; absent = pre-handoff baseline. */
  handoffId?: string;
}

export type HandoffStatus = "pending" | "accepted" | "declined";
export type HandoffChangeKind =
  | "recording-added"
  | "recording-updated"
  | "recording-removed"
  | "placement-added"
  | "placement-removed"
  | "placement-reordered"
  | "issue-added"
  | "issue-updated"
  | "issue-removed";
export type HandoffItemStatus = "pending" | "accepted" | "declined";
export type HandoffItemSeverity = "critical" | "warning" | "note";

/** A single change observed during the offline session, scoped to a clip or site. */
export interface HandoffChange {
  id: string;
  kind: HandoffChangeKind;
  summary: string;
  recordingId?: string;
  recordingTitle?: string;
  issueId?: string;
  issueTitle?: string;
  siteId?: string;
  siteName?: string;
  revision: number;
  at: string;
}

/** An unfinished item the outgoing worker flags for the receiver. */
export interface HandoffItem {
  id: string;
  title: string;
  detail: string;
  severity: HandoffItemSeverity;
  status: HandoffItemStatus;
  recordingId?: string;
  siteId?: string;
  createdAt: string;
}

/** A frozen summary of the route at session start, used to derive offline changes. */
export interface HandoffBaseline {
  revision: number;
  capturedAt: string;
  recordingIds: string[];
  siteSequences: Record<string, string[]>;
  issueIds: string[];
}

export interface HandoffPacket {
  id: string;
  sequence: number;
  status: HandoffStatus;
  outgoingName: string;
  outgoingRole: string;
  incomingName: string;
  note: string;
  baseline: HandoffBaseline;
  changes: HandoffChange[];
  openItems: HandoffItem[];
  revisionRange: { from: number; to: number };
  createdAt: string;
  decidedAt?: string;
  receiverName?: string;
  receiverNote?: string;
  supersedes?: string;
}

export interface RoutePreferences {
  pace: "brief" | "steady" | "deep";
  accessPriority: number;
  listenerCount: number;
}

export interface FieldStudy {
  id: string;
  title: string;
  fieldArea: string;
  listeningQuestion: string;
  publicationDate: string;
  stage: ProjectStage;
  lastReadinessCheck?: string;
}

export interface CommandLogEntry {
  id: string;
  commandId: string;
  originId: string;
  revision: number;
  expectedRevision: number | null;
  status: "applied" | "rejected";
  action: string;
  summary: string;
  timestamp: string;
  actor: "local-user" | "system";
}

export interface StudyState {
  version: 3;
  revision: number;
  updatedAt: string;
  project: FieldStudy;
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  release: ReleaseRecord | null;
  /** Packet history, newest last. Pending packets quarantine their content from release. */
  handoffs: HandoffPacket[];
  /** Set once an offline session begins; cleared when the packet is decided. */
  activeBaseline: HandoffBaseline | null;
  lastSavedAt?: string;
}

export interface RecordingDraft {
  catalogId: string;
  title: string;
  source: string;
  recordedOn: string;
  format: string;
  location: string;
  summary: string;
  sampleRate: string;
  channels: string;
  bitDepth: string;
  durationSeconds: string;
  signalRole: SignalRole;
  sensitivity: Sensitivity;
  transcriptStatus: TranscriptStatus;
  consentStatus: ConsentStatus;
  isFeatured: boolean;
  tags: string;
  color: string;
}

export interface IssueDraft {
  title: string;
  description: string;
  severity: IssueSeverity;
  owner: string;
  siteId: string;
  recordingId: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ConstraintFinding {
  id: string;
  type: "error" | "warning" | "notice";
  title: string;
  detail: string;
  siteId?: string;
  recordingId?: string;
}

export interface SiteAnalysis {
  siteId: string;
  durationSeconds: number;
  utilization: number;
  clipCount: number;
  clipUtilization: number;
  roleCoverage: SignalRole[];
  findings: ConstraintFinding[];
}

export interface RouteAnalysis {
  totalDurationSeconds: number;
  placedCount: number;
  unplacedCount: number;
  featuredCoverage: number;
  roleCoverage: number;
  sites: SiteAnalysis[];
  findings: ConstraintFinding[];
  blockingCount: number;
  warningCount: number;
}

export interface ReleaseResult {
  ready: boolean;
  score: number;
  blockers: string[];
  cautions: string[];
  checkedAt: string;
}

export interface ListenerScenarioInput {
  pace: RoutePreferences["pace"];
  accessPriority: number;
  listenerCount: number;
}

export interface ListenerProjection {
  durationSeconds: number;
  comfortScore: number;
  accessScore: number;
  continuityScore: number;
  pressureSiteIds: string[];
  recommendations: string[];
}

export interface ReleaseRecord {
  id: string;
  sequence: number;
  createdAt: string;
  status: "ready" | "blocked" | "stale";
  revision: number;
  fingerprint: string;
  supersedes?: string;
  readiness: ReleaseResult;
  snapshot?: Snapshot;
}

export interface Snapshot {
  schemaVersion: 2;
  generatedAt: string;
  releaseId: string;
  releaseSequence: number;
  revision: number;
  fingerprint: string;
  project: FieldStudy;
  preferences: RoutePreferences;
  summary: {
    recordingCount: number;
    siteCount: number;
    routeSeconds: number;
    readinessScore: number;
  };
  sites: Array<Site & { recordings: Recording[] }>;
  unresolvedIssues: QualityIssue[];
}
