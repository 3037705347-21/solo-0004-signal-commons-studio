export type ProjectStage = "draft" | "review" | "ready";
export type SignalRole = "arrival" | "texture" | "voice" | "departure";
export type Sensitivity = "public" | "restricted" | "sensitive";
export type TranscriptStatus = "missing" | "draft" | "verified";
export type ConsentStatus =
  | "pending"
  | "confirmed"
  | "restricted"
  | "expired"
  | "withdrawn";
export type ConsentPurpose = "route" | "transcript" | "archive";
export type ConsentGrantStatus = "active" | "restricted" | "withdrawn";
export type IssueSeverity = "note" | "warning" | "critical";
export type IssueStatus = "open" | "in-progress" | "resolved";

export interface AudioSpec {
  sampleRate: number;
  channels: 1 | 2;
  bitDepth: 16 | 24 | 32;
  durationSeconds: number;
}

/**
 * A single consent decision for a recording. The ledger is append-only:
 * withdrawing consent or narrowing its scope adds a newer grant rather than
 * editing an old one, so the authority under which every release was made
 * stays auditable.
 */
export interface ConsentGrant {
  id: string;
  recordingId: string;
  /** Current lifecycle state of this grant. */
  status: ConsentGrantStatus;
  /** Purposes this consent covers. An active grant only authorizes these uses. */
  purposes: ConsentPurpose[];
  /** Who granted the consent (person, circle, or representative). */
  grantedBy: string;
  /** How consent was captured, e.g. signed form, verbal with witness, email. */
  channel: string;
  /** Reference to the underlying evidence (form id, email, note location). */
  evidenceRef: string;
  /** Free-text note explaining a restriction, withdrawal, or expiry handling. */
  note: string;
  /** When consent took effect. */
  grantedAt: string;
  /** Optional ISO date the consent lapses on; undefined means open-ended. */
  expiresAt?: string;
  /** Set when consent is withdrawn or scoped down by a newer decision. */
  supersededAt?: string;
  createdAt: string;
}

/** Frozen, purpose-resolved consent captured inside a release snapshot. */
export interface ConsentBasis {
  grantId: string;
  recordingId: string;
  status: ConsentGrantStatus;
  purposes: ConsentPurpose[];
  grantedBy: string;
  channel: string;
  evidenceRef: string;
  grantedAt: string;
  expiresAt?: string;
  /** ISO timestamp at which this basis was resolved against the ledger. */
  resolvedAt: string;
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
  /**
   * Denormalized headline standing derived from the consent ledger
   * (`state.consents`). All enforcement reads the ledger directly; this field
   * only supports legacy storage and compact card badges.
   */
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
  version: 3;
  revision: number;
  updatedAt: string;
  project: FieldStudy;
  recordings: Recording[];
  consents: ConsentGrant[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
  auditLog: CommandLogEntry[];
  release: ReleaseRecord | null;
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
  schemaVersion: 3;
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
  sites: Array<
    Site & {
      recordings: Array<Recording & { consentBasis?: ConsentBasis }>;
    }
  >;
  /** Frozen consent ledger at release time; published content keeps this basis. */
  consents: ConsentGrant[];
  unresolvedIssues: QualityIssue[];
}
