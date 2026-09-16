import type {
  ImportBatch,
  QualityIssue,
  Recording,
  ReleaseRecord,
  RetentionCategory,
  RetentionState,
  Site,
  StudyState,
} from "./models";

/**
 * Executable retention policy.
 *
 * Each business category has a fixed retention window measured from its
 * retention anchor. A record is either:
 *  - "within-retention": the window has not elapsed,
 *  - "expired": the window elapsed and it is eligible for archival/purge,
 *  - "archived": manually parked; restorable but loses release qualification.
 *
 * Published versions and their frozen snapshots are governed by the
 * "published-release" category so an old release stays resolvable long after
 * the live study has moved on.
 */
export const RETENTION_POLICY: Record<
  RetentionCategory,
  { label: string; description: string; retentionDays: number }
> = {
  "active-recording": {
    label: "Active library clip",
    description:
      "Clips available to the listening route, whether placed or awaiting placement.",
    retentionDays: 180,
  },
  "import-batch": {
    label: "Recording import batch",
    description:
      "A batch of clips brought in together; its manifest and lineage are kept after its clips are cleaned.",
    retentionDays: 90,
  },
  "route-site": {
    label: "Listening site",
    description: "A planned stop on the listening route.",
    retentionDays: 365,
  },
  "quality-finding": {
    label: "Quality finding",
    description: "Consent, transcript, and editorial evidence findings.",
    retentionDays: 120,
  },
  "published-release": {
    label: "Published release version",
    description:
      "A frozen release with its snapshot. Retained to keep release lineage and references resolvable.",
    retentionDays: 1095,
  },
};

export const DEFAULT_RETENTION_CATEGORY: Record<
  "recording" | "site" | "issue",
  RetentionCategory
> = {
  recording: "active-recording",
  site: "route-site",
  issue: "quality-finding",
};

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function retentionAnchorFor(
  kind: "recording" | "site" | "issue",
  record: { updatedAt?: string; createdAt?: string },
): string {
  return (
    (kind === "recording"
      ? (record as Recording).updatedAt
      : record.updatedAt) ||
    record.createdAt ||
    new Date(0).toISOString()
  );
}

export interface RetentionStatus {
  category: RetentionCategory;
  state: RetentionState;
  anchor: string;
  expiresAt: string;
  daysRemaining: number;
  /** True once the retention window has elapsed but the record is still live. */
  eligibleForArchive: boolean;
}

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function evaluateRetentionStatus(
  category: RetentionCategory,
  anchor: string,
  state: RetentionState | undefined,
  now: Date = new Date(),
): RetentionStatus {
  const days = RETENTION_POLICY[category].retentionDays;
  const anchorTime = Number.isFinite(toTime(anchor))
    ? toTime(anchor)
    : now.getTime();
  const expiresAt = new Date(anchorTime + days * MS_PER_DAY);
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
  const expired = expiresAt.getTime() <= now.getTime();
  return {
    category,
    state: state ?? (expired ? "expired" : "within-retention"),
    anchor,
    expiresAt: expiresAt.toISOString(),
    daysRemaining,
    eligibleForArchive: expired,
  };
}

export function recordingRetention(
  recording: Recording,
  now: Date = new Date(),
): RetentionStatus {
  const lifecycle = recording.lifecycle;
  return evaluateRetentionStatus(
    lifecycle?.category ?? DEFAULT_RETENTION_CATEGORY.recording,
    lifecycle?.anchor ?? retentionAnchorFor("recording", recording),
    lifecycle?.state,
    now,
  );
}

export function siteRetention(site: Site, now: Date = new Date()): RetentionStatus {
  return evaluateRetentionStatus(
    site.lifecycle?.category ?? DEFAULT_RETENTION_CATEGORY.site,
    site.lifecycle?.anchor ??
      new Date(0).toISOString() /* sites carry no timestamps; seeded at migration */,
    site.lifecycle?.state,
    now,
  );
}

export function issueRetention(
  issue: QualityIssue,
  now: Date = new Date(),
): RetentionStatus {
  return evaluateRetentionStatus(
    issue.lifecycle?.category ?? DEFAULT_RETENTION_CATEGORY.issue,
    issue.lifecycle?.anchor ?? retentionAnchorFor("issue", issue),
    issue.lifecycle?.state,
    now,
  );
}

export function batchRetention(
  batch: ImportBatch,
  now: Date = new Date(),
): RetentionStatus {
  return evaluateRetentionStatus(
    "import-batch",
    batch.importedAt,
    batch.archivedAt ? "archived" : undefined,
    now,
  );
}

export function releaseRetention(
  release: ReleaseRecord,
  now: Date = new Date(),
): RetentionStatus {
  return evaluateRetentionStatus(
    "published-release",
    release.createdAt,
    release.archivedAt ? "archived" : undefined,
    now,
  );
}

/** Records that are live must participate in workflows and release checks. */
export function isLive(status: RetentionStatus): boolean {
  return status.state === "within-retention" || status.state === "expired";
}

export interface RetentionSummary {
  within: number;
  expired: number;
  archived: number;
  total: number;
}

export interface RetentionReport {
  recordings: Array<{ id: string; title: string; status: RetentionStatus }>;
  sites: Array<{ id: string; name: string; status: RetentionStatus }>;
  issues: Array<{ id: string; title: string; status: RetentionStatus }>;
  batches: Array<{ id: string; label: string; status: RetentionStatus }>;
  releases: Array<{ id: string; sequence: number; status: RetentionStatus }>;
  summary: Record<
    "recordings" | "sites" | "issues" | "batches" | "releases",
    RetentionSummary
  >;
}

function summarize(
  entries: Array<{ status: RetentionStatus }>,
): RetentionSummary {
  const summary: RetentionSummary = {
    within: 0,
    expired: 0,
    archived: 0,
    total: entries.length,
  };
  for (const entry of entries) {
    if (entry.status.state === "archived") summary.archived += 1;
    else if (entry.status.state === "expired") summary.expired += 1;
    else summary.within += 1;
  }
  return summary;
}

export function buildRetentionReport(
  state: StudyState,
  now: Date = new Date(),
): RetentionReport {
  const recordings = state.recordings.map((recording) => ({
    id: recording.id,
    title: recording.title,
    status: recordingRetention(recording, now),
  }));
  const sites = state.sites.map((site) => ({
    id: site.id,
    name: site.name,
    status: siteRetention(site, now),
  }));
  const issues = state.issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    status: issueRetention(issue, now),
  }));
  const batches = state.importBatches.map((batch) => ({
    id: batch.id,
    label: batch.label,
    status: batchRetention(batch, now),
  }));
  const releases = [
    ...(state.release ? [state.release] : []),
    ...(state.releaseHistory ?? []),
  ];
  const seenReleases = new Set<string>();
  const releaseEntries = releases
    .filter((release) => {
      if (seenReleases.has(release.id)) return false;
      seenReleases.add(release.id);
      return true;
    })
    .map((release) => ({
      id: release.id,
      sequence: release.sequence,
      status: releaseRetention(release, now),
    }));
  return {
    recordings,
    sites,
    issues,
    batches,
    releases: releaseEntries,
    summary: {
      recordings: summarize(recordings),
      sites: summarize(sites),
      issues: summarize(issues),
      batches: summarize(batches),
      releases: summarize(releaseEntries),
    },
  };
}
