export type ProjectStage = "draft" | "review" | "ready";
export type SignalRole = "arrival" | "texture" | "voice" | "departure";
export type Sensitivity = "public" | "restricted" | "sensitive";
export type SensitivePolicy =
  | "allow"
  | "review-warning"
  | "block-placement";
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

/**
 * A named set of study rules. Every numeric threshold is a fraction in the
 * 0..1 range unless it is expressed in seconds. Rule sets are immutable once
 * a version is confirmed; drafts are kept separately until adoption.
 */
export interface RuleSet {
  /** Fraction of a site's listening target that raises a headroom warning. */
  capacityWarnAt: number;
  /** Fraction of a site's listening target that blocks a placement. */
  capacityBlockAt: number;
  /** Longest clip duration accepted into the library, in seconds. */
  maxClipSeconds: number;
  /** How a sensitive clip is treated outside a quiet-playback site. */
  sensitivePolicy: SensitivePolicy;
  /** Every featured clip must be placed before release. */
  requireFeaturedPlaced: boolean;
  /** Every signal role must be represented before release. */
  requireAllRoles: boolean;
  /** Unresolved critical findings block release. */
  requireCriticalResolved: boolean;
  /** A route with no clips can never release. */
  requireNonEmptyRoute: boolean;
}

export interface RuleVersion {
  id: string;
  /** Human-facing label, e.g. "Field season 2026 baseline". */
  label: string;
  /** Short rationale for the change, recorded for historical review. */
  note: string;
  rules: RuleSet;
  /** ISO timestamp; the baseline version predates the seed study. */
  effectiveFrom: string;
  adoptedAt?: string;
}

export interface PendingRuleChange {
  label: string;
  note: string;
  rules: RuleSet;
  createdAt: string;
}

export type RuleImpactStatus =
  | "new-blocker"
  | "new-warning"
  | "cleared-blocker"
  | "cleared-warning"
  | "unchanged";

export interface RuleImpactItem {
  kind: "site" | "recording" | "release";
  id: string;
  label: string;
  status: RuleImpactStatus;
  detail: string;
}

export interface RuleImpactPreview {
  beforeAnalysis: RouteAnalysis;
  afterAnalysis: RouteAnalysis;
  beforeRelease: ReleaseResult;
  afterRelease: ReleaseResult;
  items: RuleImpactItem[];
  affectedSiteCount: number;
  affectedRecordingCount: number;
  releaseChanges: boolean;
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
  ruleVersions: RuleVersion[];
  activeRuleVersionId: string;
  pendingRuleChange: PendingRuleChange | null;
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
  /** Rule version in force when this release check ran. */
  ruleVersionId: string;
  ruleLabel: string;
  supersedes?: string;
  readiness: ReleaseResult;
  snapshot?: Snapshot;
}

export interface Snapshot {
  schemaVersion: 3;
  generatedAt: string;
  releaseId: string;
  releaseSequence: number;
  revision: number;
  fingerprint: string;
  /** Frozen rule basis: published snapshots always present under these rules. */
  ruleVersion: {
    id: string;
    label: string;
    note: string;
    rules: RuleSet;
    effectiveFrom: string;
  };
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
