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
  version: 2;
  revision: number;
  updatedAt: string;
  project: FieldStudy;
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  release: ReleaseRecord | null;
  lastSavedAt?: string;
}

export type ConflictSide = "base" | "ours" | "theirs";
export type ConflictRowStatus =
  | "ours-only"
  | "theirs-only"
  | "unchanged"
  | "agreed"
  | "conflict";
export type ConflictSection = "recordings" | "sites" | "issues" | "planning";
export type MergeChoice = "ours" | "theirs";
export type ConflictResolutionMode = "theirs" | "ours" | "merge" | "draft";

export interface ConflictRow {
  id: string;
  section: ConflictSection;
  label: string;
  detail?: string;
  status: ConflictRowStatus;
  baseValue?: string;
  oursValue?: string;
  theirsValue?: string;
}

export interface MergeConflictRow extends ConflictRow {
  /** Rows that both sides changed differently must be resolved explicitly. */
  resolvable: boolean;
  choice: MergeChoice;
}

export interface MergeReport {
  sections: Array<{
    section: ConflictSection;
    label: string;
    conflictCount: number;
    autoCount: number;
  }>;
}

export interface StudyChangeExplanation {
  rows: ConflictRow[];
  oursOnlyCount: number;
  theirsOnlyCount: number;
  agreedCount: number;
  conflictCount: number;
}

export interface StudyMergeResult {
  merged: StudyState;
  rows: MergeConflictRow[];
  report: MergeReport;
}

/** A detected concurrent edit, persisted until a teammate chooses an outcome. */
export interface ConflictRecord {
  id: string;
  detectedAt: string;
  originId: string;
  originLabel: string;
  commandSummary: string;
  baseRevision: number;
  oursRevision: number;
  theirsRevision: number;
  base: StudyState;
  ours: StudyState;
  theirs: StudyState;
}

/** A local edit parked via "save my version as a draft". */
export interface ConflictDraft {
  id: string;
  createdAt: string;
  originId: string;
  commandSummary: string;
  baseRevision: number;
  theirsRevision: number;
  base: StudyState;
  ours: StudyState;
  theirs: StudyState;
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
