import type {
  AudioSpec,
  CommandLogEntry,
  HandoffBaseline,
  HandoffChange,
  HandoffItem,
  HandoffPacket,
  QualityIssue,
  Recording,
  ReleaseRecord,
  ReleaseResult,
  RoutePreferences,
  Site,
  Snapshot,
  StudyState,
} from "../domain/models";
import { releaseFingerprint } from "../domain/releaseIdentity";

const PROJECT_STAGES = new Set(["draft", "review", "ready"]);
const SIGNAL_ROLES = new Set(["arrival", "texture", "voice", "departure"]);
const SENSITIVITIES = new Set(["public", "restricted", "sensitive"]);
const TRANSCRIPT_STATUSES = new Set(["missing", "draft", "verified"]);
const CONSENT_STATUSES = new Set(["pending", "confirmed", "restricted"]);
const ISSUE_SEVERITIES = new Set(["note", "warning", "critical"]);
const ISSUE_STATUSES = new Set(["open", "in-progress", "resolved"]);
const HANDOFF_STATUSES = new Set(["pending", "accepted", "declined"]);
const HANDOFF_CHANGE_KINDS = new Set([
  "recording-added",
  "recording-updated",
  "recording-removed",
  "placement-added",
  "placement-removed",
  "placement-reordered",
  "issue-added",
  "issue-updated",
  "issue-removed",
]);
const HANDOFF_ITEM_SEVERITIES = new Set(["critical", "warning", "note"]);
const HANDOFF_ITEM_STATUSES = new Set(["pending", "accepted", "declined"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isAudioSpec(value: unknown): value is AudioSpec {
  if (!isRecord(value)) return false;
  return (
    isPositiveNumber(value.sampleRate) &&
    (value.channels === 1 || value.channels === 2) &&
    (value.bitDepth === 16 ||
      value.bitDepth === 24 ||
      value.bitDepth === 32) &&
    isPositiveNumber(value.durationSeconds)
  );
}

function isRecording(value: unknown): value is Recording {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.catalogId) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.recordedOn) &&
    isNonEmptyString(value.format) &&
    isNonEmptyString(value.location) &&
    isNonEmptyString(value.summary) &&
    isAudioSpec(value.audioSpec) &&
    typeof value.signalRole === "string" &&
    SIGNAL_ROLES.has(value.signalRole) &&
    typeof value.sensitivity === "string" &&
    SENSITIVITIES.has(value.sensitivity) &&
    typeof value.transcriptStatus === "string" &&
    TRANSCRIPT_STATUSES.has(value.transcriptStatus) &&
    typeof value.consentStatus === "string" &&
    CONSENT_STATUSES.has(value.consentStatus) &&
    typeof value.isFeatured === "boolean" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.color === "string" &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    (value.handoffId === undefined ||
      value.handoffId === null ||
      typeof value.handoffId === "string")
  );
}

function isSite(value: unknown): value is Site {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.shortLabel) &&
    isNonEmptyString(value.prompt) &&
    isPositiveNumber(value.maxDurationSeconds) &&
    Number.isInteger(value.maxClips) &&
    Number(value.maxClips) > 0 &&
    typeof value.quietSpace === "boolean" &&
    typeof value.hasSeating === "boolean" &&
    typeof value.color === "string" &&
    Number.isInteger(value.sequence) &&
    Array.isArray(value.recordingIds) &&
    value.recordingIds.every((id) => typeof id === "string")
  );
}

function isIssue(value: unknown): value is QualityIssue {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.description) &&
    typeof value.severity === "string" &&
    ISSUE_SEVERITIES.has(value.severity) &&
    typeof value.status === "string" &&
    ISSUE_STATUSES.has(value.status) &&
    isNonEmptyString(value.owner) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    (value.handoffId === undefined ||
      value.handoffId === null ||
      typeof value.handoffId === "string")
  );
}

function isPreferences(value: unknown): value is RoutePreferences {
  if (!isRecord(value)) return false;
  return (
    (value.pace === "brief" ||
      value.pace === "steady" ||
      value.pace === "deep") &&
    typeof value.accessPriority === "number" &&
    Number.isFinite(value.accessPriority) &&
    typeof value.listenerCount === "number" &&
    Number.isFinite(value.listenerCount)
  );
}

function isProject(value: unknown): value is StudyState["project"] {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.fieldArea) &&
    isNonEmptyString(value.listeningQuestion) &&
    isNonEmptyString(value.publicationDate) &&
    typeof value.stage === "string" &&
    PROJECT_STAGES.has(value.stage)
  );
}

function migrateAuditEntry(value: unknown): CommandLogEntry | null {
  if (!isRecord(value)) return null;
  if (
    isNonEmptyString(value.id) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isNonEmptyString(value.action) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.timestamp) &&
    (value.actor === "local-user" || value.actor === "system")
  ) {
    return {
      id: value.id,
      commandId: isNonEmptyString(value.commandId) ? value.commandId : value.id,
      originId: isNonEmptyString(value.originId) ? value.originId : "legacy",
      revision: Number(value.revision),
      expectedRevision: Number.isInteger(value.expectedRevision)
        ? Number(value.expectedRevision)
        : null,
      status: value.status === "rejected" ? "rejected" : "applied",
      action: value.action,
      summary: value.summary,
      timestamp: value.timestamp,
      actor: value.actor,
    };
  }
  return null;
}

function isReleaseResult(value: unknown): value is ReleaseResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.ready === "boolean" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    Array.isArray(value.blockers) &&
    value.blockers.every((blocker) => typeof blocker === "string") &&
    Array.isArray(value.cautions) &&
    value.cautions.every((caution) => typeof caution === "string") &&
    isNonEmptyString(value.checkedAt)
  );
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== 2 ||
    !isNonEmptyString(value.generatedAt) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isNonEmptyString(value.fingerprint) ||
    !isProject(value.project) ||
    !isPreferences(value.preferences) ||
    !isRecord(value.summary) ||
    !Array.isArray(value.sites) ||
    !Array.isArray(value.unresolvedIssues)
  )
    return false;
  return (
    typeof value.summary.recordingCount === "number" &&
    typeof value.summary.siteCount === "number" &&
    typeof value.summary.routeSeconds === "number" &&
    typeof value.summary.readinessScore === "number"
  );
}

function migrateRelease(value: unknown): ReleaseRecord | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== "ready" &&
    value.status !== "blocked" &&
    value.status !== "stale"
  )
    return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0)
    return null;
  if (typeof value.fingerprint !== "string" || !value.fingerprint) return null;
  if (!isReleaseResult(value.readiness)) return null;
  const releaseId = isNonEmptyString(value.id)
    ? value.id
    : `release-legacy-${Number(value.revision)}`;
  const sequence =
    Number.isInteger(value.sequence) && Number(value.sequence) > 0
      ? Number(value.sequence)
      : 1;
  const snapshot = isSnapshot(value.snapshot)
    ? {
        ...value.snapshot,
        releaseId: isNonEmptyString(value.snapshot.releaseId)
          ? value.snapshot.releaseId
          : releaseId,
        releaseSequence:
          Number.isInteger(value.snapshot.releaseSequence) &&
          Number(value.snapshot.releaseSequence) > 0
            ? Number(value.snapshot.releaseSequence)
            : sequence,
      }
    : value.snapshot === undefined
      ? undefined
      : null;
  if (snapshot === null || (value.status === "ready" && !snapshot)) return null;
  return {
    id: releaseId,
    sequence,
    createdAt: isNonEmptyString(value.createdAt)
      ? value.createdAt
      : value.readiness.checkedAt,
    status: value.status,
    revision: Number(value.revision),
    fingerprint: value.fingerprint,
    supersedes: isNonEmptyString(value.supersedes)
      ? value.supersedes
      : undefined,
    readiness: value.readiness,
    snapshot,
  };
}

function migratedUpdatedAt(state: StudyState): string {
  const timestamps = [
    state.project.lastReadinessCheck,
    ...state.recordings.map((recording) => recording.updatedAt),
    ...state.issues.map((issue) => issue.updatedAt),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : "1970-01-01T00:00:00.000Z";
}

function migrateHandoffBaseline(value: unknown): HandoffBaseline | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isNonEmptyString(value.capturedAt) ||
    !Array.isArray(value.recordingIds) ||
    !value.recordingIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.issueIds) ||
    !value.issueIds.every((id) => typeof id === "string") ||
    !isRecord(value.siteSequences)
  )
    return null;
  const siteSequences: Record<string, string[]> = {};
  for (const [siteId, ids] of Object.entries(value.siteSequences)) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string"))
      return null;
    siteSequences[siteId] = ids;
  }
  return {
    revision: Number(value.revision),
    capturedAt: value.capturedAt,
    recordingIds: value.recordingIds,
    siteSequences,
    issueIds: value.issueIds,
  };
}

function migrateHandoffChange(value: unknown): HandoffChange | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !HANDOFF_CHANGE_KINDS.has(value.kind as string) ||
    !isNonEmptyString(value.summary) ||
    !Number.isInteger(value.revision) ||
    !isNonEmptyString(value.at)
  )
    return null;
  return {
    id: value.id,
    kind: value.kind as HandoffChange["kind"],
    summary: value.summary,
    recordingId: isNonEmptyString(value.recordingId)
      ? value.recordingId
      : undefined,
    recordingTitle: isNonEmptyString(value.recordingTitle)
      ? value.recordingTitle
      : undefined,
    issueId: isNonEmptyString(value.issueId) ? value.issueId : undefined,
    issueTitle: isNonEmptyString(value.issueTitle)
      ? value.issueTitle
      : undefined,
    siteId: isNonEmptyString(value.siteId) ? value.siteId : undefined,
    siteName: isNonEmptyString(value.siteName) ? value.siteName : undefined,
    revision: Number(value.revision),
    at: value.at,
  };
}

function migrateHandoffItem(value: unknown): HandoffItem | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    typeof value.detail !== "string" ||
    !HANDOFF_ITEM_SEVERITIES.has(value.severity as string) ||
    !HANDOFF_ITEM_STATUSES.has(value.status as string) ||
    !isNonEmptyString(value.createdAt)
  )
    return null;
  return {
    id: value.id,
    title: value.title,
    detail: value.detail,
    severity: value.severity as HandoffItem["severity"],
    status: value.status as HandoffItem["status"],
    recordingId: isNonEmptyString(value.recordingId)
      ? value.recordingId
      : undefined,
    siteId: isNonEmptyString(value.siteId) ? value.siteId : undefined,
    createdAt: value.createdAt,
  };
}

function migrateHandoff(value: unknown): HandoffPacket | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !HANDOFF_STATUSES.has(value.status as string) ||
    !isNonEmptyString(value.outgoingName) ||
    typeof value.outgoingRole !== "string" ||
    typeof value.incomingName !== "string" ||
    typeof value.note !== "string" ||
    !isRecord(value.baseline) ||
    !Array.isArray(value.changes) ||
    !Array.isArray(value.openItems) ||
    !isRecord(value.revisionRange) ||
    !isNonEmptyString(value.createdAt)
  )
    return null;
  const baseline = migrateHandoffBaseline(value.baseline);
  if (!baseline) return null;
  const changes = value.changes
    .map(migrateHandoffChange)
    .filter((change): change is HandoffChange => Boolean(change));
  const openItems = value.openItems
    .map(migrateHandoffItem)
    .filter((item): item is HandoffItem => Boolean(item));
  const sequence =
    Number.isInteger(value.sequence) && Number(value.sequence) > 0
      ? Number(value.sequence)
      : 1;
  const revisionRange = {
    from: Number.isInteger(value.revisionRange.from)
      ? Number(value.revisionRange.from)
      : baseline.revision,
    to: Number.isInteger(value.revisionRange.to)
      ? Number(value.revisionRange.to)
      : baseline.revision,
  };
  return {
    id: value.id,
    sequence,
    status: value.status as HandoffPacket["status"],
    outgoingName: value.outgoingName,
    outgoingRole: value.outgoingRole,
    incomingName: value.incomingName,
    note: value.note,
    baseline,
    changes,
    openItems,
    revisionRange,
    createdAt: value.createdAt,
    decidedAt: isNonEmptyString(value.decidedAt)
      ? value.decidedAt
      : undefined,
    receiverName: isNonEmptyString(value.receiverName)
      ? value.receiverName
      : undefined,
    receiverNote:
      typeof value.receiverNote === "string" ? value.receiverNote : undefined,
    supersedes: isNonEmptyString(value.supersedes)
      ? value.supersedes
      : undefined,
  };
}

export function migrateWorkspace(value: unknown): StudyState | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3)
    return null;
  if (!isProject(value.project)) return null;
  if (!Array.isArray(value.recordings) || !value.recordings.every(isRecording))
    return null;
  if (!Array.isArray(value.sites) || !value.sites.every(isSite)) return null;
  if (!Array.isArray(value.issues) || !value.issues.every(isIssue)) return null;
  if (!isPreferences(value.preferences)) return null;

  if (value.version === 1) {
    const legacy: StudyState = {
      version: 3,
      revision: 0,
      updatedAt: "",
      project: value.project,
      recordings: value.recordings,
      sites: value.sites,
      issues: value.issues,
      preferences: value.preferences,
      auditLog: [],
      release: null,
      handoffs: [],
      activeBaseline: null,
    };
    return {
      ...legacy,
      updatedAt: migratedUpdatedAt(legacy),
    };
  }

  if (!Number.isInteger(value.revision) || Number(value.revision) < 0)
    return null;
  const auditLog = Array.isArray(value.auditLog)
    ? value.auditLog
        .map(migrateAuditEntry)
        .filter((entry): entry is CommandLogEntry => Boolean(entry))
    : [];
  const handoffs =
    value.version === 3 && Array.isArray(value.handoffs)
      ? value.handoffs
          .map(migrateHandoff)
          .filter((handoff): handoff is HandoffPacket => Boolean(handoff))
      : [];
  // Restore an open session baseline whether or not its packet exists yet; a
  // mid-session reload must not silently end the tracked offline session.
  const activeBaseline =
    value.version === 3 ? migrateHandoffBaseline(value.activeBaseline) : null;
  return {
    version: 3,
    revision: Number(value.revision),
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt
      : new Date().toISOString(),
    project: value.project,
    recordings: value.recordings.map(withRecordingProvenance),
    sites: value.sites,
    issues: value.issues.map(withIssueProvenance),
    preferences: value.preferences,
    auditLog,
    release: migrateRelease(value.release),
    handoffs,
    activeBaseline,
    lastSavedAt: isNonEmptyString(value.lastSavedAt)
      ? value.lastSavedAt
      : undefined,
  };
}

function withRecordingProvenance(recording: Recording): Recording {
  return "handoffId" in recording && isNonEmptyString(recording.handoffId)
    ? { ...recording, handoffId: recording.handoffId }
    : recording;
}

function withIssueProvenance(issue: QualityIssue): QualityIssue {
  return "handoffId" in issue && isNonEmptyString(issue.handoffId)
    ? { ...issue, handoffId: issue.handoffId }
    : issue;
}

export function validateReferences(state: StudyState): StudyState {
  const recordingIds = new Set(
    state.recordings.map((recording) => recording.id),
  );
  const siteIds = new Set(state.sites.map((site) => site.id));
  const placedRecordingIds = new Set<string>();
  const sites = state.sites.map((site) => ({
    ...site,
    recordingIds: site.recordingIds.filter((id) => {
      if (!recordingIds.has(id) || placedRecordingIds.has(id)) return false;
      placedRecordingIds.add(id);
      return true;
    }),
  }));
  const issues = state.issues.map((issue) => ({
    ...issue,
    siteId:
      issue.siteId && siteIds.has(issue.siteId) ? issue.siteId : undefined,
    recordingId:
      issue.recordingId && recordingIds.has(issue.recordingId)
        ? issue.recordingId
        : undefined,
  }));
  // Keep provenance pointers resolvable; a dangling handoff id means the
  // lineage record was lost, so fall back to pre-handoff baseline content.
  const handoffIds = new Set(state.handoffs.map((handoff) => handoff.id));
  const recordings = state.recordings.map((recording) =>
    recording.handoffId && !handoffIds.has(recording.handoffId)
      ? { ...recording, handoffId: undefined }
      : recording,
  );
  const resolvedIssues = issues.map((issue) =>
    issue.handoffId && !handoffIds.has(issue.handoffId)
      ? { ...issue, handoffId: undefined }
      : issue,
  );
  const normalized = {
    ...state,
    recordings,
    sites,
    issues: resolvedIssues,
  };
  if (
    normalized.release?.status === "ready" &&
    normalized.release.fingerprint !== releaseFingerprint(normalized)
  ) {
    return {
      ...normalized,
      release: { ...normalized.release, status: "stale" },
    };
  }
  return normalized;
}
