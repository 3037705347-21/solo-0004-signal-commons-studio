export type ProjectStage = "draft" | "review" | "ready";
export type SignalRole = "arrival" | "texture" | "voice" | "departure";
export type Sensitivity = "public" | "restricted" | "sensitive";
export type TranscriptStatus = "missing" | "draft" | "verified";
export type ConsentStatus = "pending" | "confirmed" | "restricted";
export type IssueSeverity = "note" | "warning" | "critical";
export type IssueStatus = "open" | "in-progress" | "resolved";

/** Business categories covered by the executable retention policy. */
export type RetentionCategory =
  | "active-recording"
  | "import-batch"
  | "route-site"
  | "quality-finding"
  | "published-release";

/**
 * Lifecycle state from the retention policy's point of view.
 * - within-retention: inside the category window;
 * - expired: window elapsed, still live but eligible for archival/purge;
 * - archived: parked out of workflows; restorable but must re-qualify for release.
 */
export type RetentionState = "within-retention" | "expired" | "archived";

export interface LifecycleMeta {
  category: RetentionCategory;
  state: RetentionState;
  /** When the retention window starts (ISO timestamp). */
  anchor: string;
  archivedAt?: string;
  archiveReason?: string;
  restoredAt?: string;
}

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
  importBatchId?: string;
  lifecycle?: LifecycleMeta;
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
  lifecycle?: LifecycleMeta;
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
  lifecycle?: LifecycleMeta;
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

/**
 * A group of recordings brought in together. The batch record outlives the
 * clips it brought in: once its clips are cleaned, the manifest (counts,
 * source, retained clip ids) still resolves so import lineage never dangles.
 */
export interface ImportBatch {
  id: string;
  label: string;
  source: string;
  importedAt: string;
  /** Clip ids the batch originally delivered, in import order. */
  recordingIds: string[];
  note?: string;
  archivedAt?: string;
}

/** Kind of a purged record, used by reference tombstones. */
export type RetainedEntityKind = "recording" | "site" | "issue";

/**
 * A tombstone left behind when a record is physically purged. Frozen
 * releases, import batches, and route references resolve through these so no
 * existing citation ever becomes a dangling identifier.
 */
export interface RetentionTombstone {
  id: string;
  kind: RetainedEntityKind;
  label: string;
  category: RetentionCategory;
  purgedAt: string;
  reason: "expired-purge" | "manual-purge";
  /** Release versions that still cite this record (lineage protection). */
  referencedByReleaseIds: string[];
  /** Import batch that delivered the record, when known. */
  importBatchId?: string;
}

export interface StudyState {
  version: 3;
  revision: number;
  updatedAt: string;
  project: FieldStudy;
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  importBatches: ImportBatch[];
  tombstones: RetentionTombstone[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  release: ReleaseRecord | null;
  /**
   * Superseded release versions. They keep their frozen snapshots so the
   * release lineage and every citation from an older version stays resolvable.
   */
  releaseHistory?: ReleaseRecord[];
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
  archivedAt?: string;
}

/**
 * Uniform reference resolution result. Live records resolve to themselves;
 * records physically purged resolve to a stub backed by a tombstone (or by
 * the frozen snapshot of a release) so citations never dangle.
 */
export interface ResolvedReferenceStub {
  id: string;
  kind: RetainedEntityKind;
  label: string;
  availability: "live" | "archived" | "purged";
  tombstone?: RetentionTombstone;
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
