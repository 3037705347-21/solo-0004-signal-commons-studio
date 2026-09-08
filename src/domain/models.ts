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

export interface StudyState {
  version: 1;
  project: FieldStudy;
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  preferences: RoutePreferences;
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

export interface Snapshot {
  schemaVersion: 1;
  generatedAt: string;
  project: FieldStudy;
  summary: {
    recordingCount: number;
    siteCount: number;
    routeSeconds: number;
    readinessScore: number;
  };
  sites: Array<Site & { recordings: Recording[] }>;
  unresolvedIssues: QualityIssue[];
}
