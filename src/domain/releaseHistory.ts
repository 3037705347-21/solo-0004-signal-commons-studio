import type {
  QualityIssue,
  Recording,
  ReleaseContent,
  ReleaseRecord,
  Site,
  StudyState,
} from "./models";
import { analyzeRoute } from "./routeAnalysis";

/**
 * Entries are frozen at check time so application code cannot accidentally
 * rewrite history while reusing the same object references.
 */
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach((nested) => deepFreeze(nested));
  return Object.freeze(value);
}

export function captureReleaseContent(
  state: StudyState,
  capturedAt: string,
): ReleaseContent {
  return deepFreeze({
    capturedAt,
    project: {
      id: state.project.id,
      title: state.project.title,
      fieldArea: state.project.fieldArea,
      listeningQuestion: state.project.listeningQuestion,
      publicationDate: state.project.publicationDate,
    },
    recordings: state.recordings.map((recording) => ({
      ...recording,
      tags: [...recording.tags],
      audioSpec: { ...recording.audioSpec },
    })),
    sites: state.sites.map((site) => ({
      ...site,
      recordingIds: [...site.recordingIds],
    })),
    issues: state.issues.map((issue) => ({ ...issue })),
    preferences: { ...state.preferences },
  });
}

export type ReleaseLineageStatus =
  | "current"
  | "stale"
  | "superseded"
  | "blocked"
  | "blocked-superseded";

export interface ReleaseStatusView {
  status: ReleaseLineageStatus;
  label: string;
  detail: string;
}

/**
 * Derives the display status of a history entry. History itself is immutable;
 * being "superseded" or "stale" is a relationship to later entries and to the
 * live workspace, never a mutation of the stored version.
 */
export function describeReleaseStatus(
  entry: ReleaseRecord,
  history: ReleaseRecord[],
  currentFingerprint: string,
): ReleaseStatusView {
  const laterEntry = history.find(
    (candidate) => candidate.sequence > entry.sequence,
  );
  if (entry.status === "ready") {
    if (!laterEntry && entry.fingerprint === currentFingerprint) {
      return {
        status: "current",
        label: "Current release",
        detail: "This version still matches the publishable workspace.",
      };
    }
    if (!laterEntry) {
      return {
        status: "stale",
        label: "Stale",
        detail:
          "The workspace changed after this check. Re-run the readiness check before publishing.",
      };
    }
    return {
      status: "superseded",
      label: `Superseded by v${laterEntry.sequence}`,
      detail:
        laterEntry.status === "ready"
          ? `A newer successful check (v${laterEntry.sequence}) replaced this version.`
          : `A later check (v${laterEntry.sequence}) did not pass and cannot replace what was approved here.`,
    };
  }
  if (entry.status === "blocked") {
    if (!laterEntry) {
      return {
        status: "blocked",
        label: "Check blocked",
        detail: "This check found blocking conditions and produced no release.",
      };
    }
    return {
      status: "blocked-superseded",
      label: `Blocked · followed by v${laterEntry.sequence}`,
      detail: "This check did not pass; the team continued in a later version.",
    };
  }
  // The live head copy can carry "stale"; history copies always retain their
  // evaluated status, so this only occurs when viewing the mutated head object.
  return {
    status: "stale",
    label: "Stale",
    detail: "The workspace changed after this check.",
  };
}

export function findRelease(
  history: ReleaseRecord[],
  releaseId: string,
): ReleaseRecord | undefined {
  return history.find((entry) => entry.id === releaseId);
}

export function canForkDraft(entry: ReleaseRecord | undefined): boolean {
  return Boolean(entry?.content);
}

/* ----------------------------- version diff ----------------------------- */

export type ChangeKind = "added" | "removed" | "changed";

export interface RecordingChange {
  kind: ChangeKind;
  recordingId: string;
  catalogId: string;
  title: string;
  fields: Array<{ field: string; from: string; to: string }>;
  placementChanged: boolean;
  placementFrom: string;
  placementTo: string;
}

export interface SiteChange {
  kind: ChangeKind;
  siteId: string;
  name: string;
  fields: Array<{ field: string; from: string; to: string }>;
  clipsAdded: Recording[];
  clipsRemoved: Recording[];
  reordered: boolean;
}

export interface IssueChange {
  kind: ChangeKind;
  issueId: string;
  title: string;
  severity: QualityIssue["severity"];
  fields: Array<{ field: string; from: string; to: string }>;
}

export interface ReleaseDiff {
  from: ReleaseRecord;
  to: ReleaseRecord;
  recordings: RecordingChange[];
  sites: SiteChange[];
  issues: IssueChange[];
  totals: {
    recordingCount: { from: number; to: number };
    siteCount: { from: number; to: number };
    openIssues: { from: number; to: number };
    routeSeconds: { from: number; to: number };
    readinessScore: { from: number; to: number };
  };
  hasChanges: boolean;
}

function placementOf(
  content: ReleaseContent,
  recordingId: string,
): { site: Site | undefined; index: number } {
  for (const site of content.sites
    .slice()
    .sort((a, b) => a.sequence - b.sequence)) {
    const index = site.recordingIds.indexOf(recordingId);
    if (index !== -1) return { site, index };
  }
  return { site: undefined, index: -1 };
}

function placementLabel(
  content: ReleaseContent,
  recordingId: string,
): string {
  const { site, index } = placementOf(content, recordingId);
  return site ? `${site.shortLabel} #${index + 1}` : "Unplaced";
}

function diffField(
  field: string,
  from: unknown,
  to: unknown,
  format: (value: unknown) => string = String,
): { field: string; from: string; to: string } | null {
  if (JSON.stringify(from) === JSON.stringify(to)) return null;
  return { field, from: format(from), to: format(to) };
}

const RECORDING_FIELDS: Array<{
  label: string;
  value: (recording: Recording) => unknown;
}> = [
  { label: "Catalogue ID", value: (r) => r.catalogId },
  { label: "Title", value: (r) => r.title },
  { label: "Source", value: (r) => r.source },
  { label: "Capture location", value: (r) => r.location },
  { label: "Format", value: (r) => r.format },
  {
    label: "Signal role",
    value: (r) => r.signalRole,
  },
  {
    label: "Sensitivity",
    value: (r) => r.sensitivity,
  },
  {
    label: "Transcript",
    value: (r) => r.transcriptStatus,
  },
  {
    label: "Consent",
    value: (r) => r.consentStatus,
  },
  {
    label: "Featured clip",
    value: (r) => (r.isFeatured ? "Featured" : "Not featured"),
  },
  {
    label: "Duration (sec)",
    value: (r) => r.audioSpec.durationSeconds,
  },
];

const SITE_FIELDS: Array<{
  label: string;
  value: (site: Site) => unknown;
}> = [
  { label: "Site name", value: (s) => s.name },
  { label: "Research prompt", value: (s) => s.prompt },
  {
    label: "Listening target",
    value: (s) => `${s.maxDurationSeconds} sec`,
  },
  { label: "Clip capacity", value: (s) => s.maxClips },
  {
    label: "Quiet playback",
    value: (s) => (s.quietSpace ? "Supported" : "Not supported"),
  },
  {
    label: "Seating",
    value: (s) => (s.hasSeating ? "Available" : "Unavailable"),
  },
];

const ISSUE_FIELDS: Array<{
  label: string;
  value: (issue: QualityIssue) => unknown;
}> = [
  { label: "Title", value: (i) => i.title },
  { label: "Severity", value: (i) => i.severity },
  { label: "Status", value: (i) => i.status },
  { label: "Owner", value: (i) => i.owner },
  { label: "Description", value: (i) => i.description },
];

function diffRecordings(
  from: ReleaseContent,
  to: ReleaseContent,
): RecordingChange[] {
  const changes: RecordingChange[] = [];
  const fromById = new Map(from.recordings.map((r) => [r.id, r]));
  const toById = new Map(to.recordings.map((r) => [r.id, r]));

  for (const recording of to.recordings) {
    const previous = fromById.get(recording.id);
    if (!previous) {
      changes.push({
        kind: "added",
        recordingId: recording.id,
        catalogId: recording.catalogId,
        title: recording.title,
        fields: [],
        placementChanged: true,
        placementFrom: "Not in study",
        placementTo: placementLabel(to, recording.id),
      });
      continue;
    }
    const fields = RECORDING_FIELDS.map(({ label, value }) =>
      diffField(label, value(previous), value(recording)),
    ).filter((field): field is NonNullable<typeof field> => Boolean(field));
    const fromPlacement = placementLabel(from, recording.id);
    const toPlacement = placementLabel(to, recording.id);
    if (fields.length || fromPlacement !== toPlacement) {
      changes.push({
        kind: "changed",
        recordingId: recording.id,
        catalogId: recording.catalogId,
        title: recording.title,
        fields,
        placementChanged: fromPlacement !== toPlacement,
        placementFrom: fromPlacement,
        placementTo: toPlacement,
      });
    }
  }

  for (const recording of from.recordings) {
    if (!toById.has(recording.id)) {
      changes.push({
        kind: "removed",
        recordingId: recording.id,
        catalogId: recording.catalogId,
        title: recording.title,
        fields: [],
        placementChanged: true,
        placementFrom: placementLabel(from, recording.id),
        placementTo: "Removed from study",
      });
    }
  }
  return changes;
}

function diffSites(from: ReleaseContent, to: ReleaseContent): SiteChange[] {
  const changes: SiteChange[] = [];
  const fromById = new Map(from.sites.map((s) => [s.id, s]));
  const toById = new Map(to.sites.map((s) => [s.id, s]));
  const recordingById = new Map(
    [...from.recordings, ...to.recordings].map((r) => [r.id, r]),
  );
  const resolveClips = (ids: string[]) =>
    ids
      .map((id) => recordingById.get(id))
      .filter((r): r is Recording => Boolean(r));

  for (const site of to.sites) {
    const previous = fromById.get(site.id);
    if (!previous) {
      changes.push({
        kind: "added",
        siteId: site.id,
        name: site.name,
        fields: [],
        clipsAdded: resolveClips(site.recordingIds),
        clipsRemoved: [],
        reordered: false,
      });
      continue;
    }
    const fields = SITE_FIELDS.map(({ label, value }) =>
      diffField(label, value(previous), value(site)),
    ).filter((field): field is NonNullable<typeof field> => Boolean(field));
    const previousIds = previous.recordingIds;
    const nextIds = site.recordingIds;
    const clipsAdded = resolveClips(
      nextIds.filter((id) => !previousIds.includes(id)),
    );
    const clipsRemoved = resolveClips(
      previousIds.filter((id) => !nextIds.includes(id)),
    );
    const sharedReordered =
      clipsAdded.length === 0 &&
      clipsRemoved.length === 0 &&
      previousIds.length === nextIds.length &&
      previousIds.some((id, index) => nextIds[index] !== id);
    if (fields.length || clipsAdded.length || clipsRemoved.length || sharedReordered) {
      changes.push({
        kind: "changed",
        siteId: site.id,
        name: site.name,
        fields,
        clipsAdded,
        clipsRemoved,
        reordered: sharedReordered,
      });
    }
  }

  for (const site of from.sites) {
    if (!toById.has(site.id)) {
      changes.push({
        kind: "removed",
        siteId: site.id,
        name: site.name,
        fields: [],
        clipsAdded: [],
        clipsRemoved: resolveClips(site.recordingIds),
        reordered: false,
      });
    }
  }
  return changes;
}

function issueSeverityOf(content: ReleaseContent, issueId: string) {
  return content.issues.find((issue) => issue.id === issueId)?.severity ?? "note";
}

function diffIssues(from: ReleaseContent, to: ReleaseContent): IssueChange[] {
  const changes: IssueChange[] = [];
  const fromById = new Map(from.issues.map((i) => [i.id, i]));
  const toById = new Map(to.issues.map((i) => [i.id, i]));

  for (const issue of to.issues) {
    const previous = fromById.get(issue.id);
    if (!previous) {
      changes.push({
        kind: "added",
        issueId: issue.id,
        title: issue.title,
        severity: issue.severity,
        fields: [],
      });
      continue;
    }
    const fields = ISSUE_FIELDS.map(({ label, value }) =>
      diffField(label, value(previous), value(issue)),
    ).filter((field): field is NonNullable<typeof field> => Boolean(field));
    if (fields.length) {
      changes.push({
        kind: "changed",
        issueId: issue.id,
        title: issue.title,
        severity: issue.severity,
        fields,
      });
    }
  }

  for (const issue of from.issues) {
    if (!toById.has(issue.id)) {
      changes.push({
        kind: "removed",
        issueId: issue.id,
        title: issue.title,
        severity: issueSeverityOf(from, issue.id),
        fields: [],
      });
    }
  }
  return changes;
}

const openIssues = (content: ReleaseContent) =>
  content.issues.filter((issue) => issue.status !== "resolved").length;

/**
 * Compares two frozen versions. Versions produced by older schemas may lack
 * frozen content and cannot be compared.
 */
export function diffReleases(
  from: ReleaseRecord,
  to: ReleaseRecord,
): ReleaseDiff | null {
  if (!from.content || !to.content) return null;
  const recordings = diffRecordings(from.content, to.content);
  const sites = diffSites(from.content, to.content);
  const issues = diffIssues(from.content, to.content);
  const fromAnalysis = analyzeRoute(
    from.content.recordings,
    from.content.sites,
  );
  const toAnalysis = analyzeRoute(to.content.recordings, to.content.sites);
  return {
    from,
    to,
    recordings,
    sites,
    issues,
    totals: {
      recordingCount: {
        from: from.content.recordings.length,
        to: to.content.recordings.length,
      },
      siteCount: {
        from: from.content.sites.length,
        to: to.content.sites.length,
      },
      openIssues: {
        from: openIssues(from.content),
        to: openIssues(to.content),
      },
      routeSeconds: {
        from: fromAnalysis.totalDurationSeconds,
        to: toAnalysis.totalDurationSeconds,
      },
      readinessScore: {
        from: from.readiness.score,
        to: to.readiness.score,
      },
    },
    hasChanges:
      recordings.length > 0 || sites.length > 0 || issues.length > 0,
  };
}
