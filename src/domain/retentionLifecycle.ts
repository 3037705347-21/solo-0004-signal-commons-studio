import type {
  RetentionCategory,
  RetentionTombstone,
  Site,
  StudyState,
} from "./models";
import {
  DEFAULT_RETENTION_CATEGORY,
  RETENTION_POLICY,
  evaluateRetentionStatus,
  issueRetention,
  recordingRetention,
  siteRetention,
} from "./retention";
import { releasesReferencingRecording } from "./retentionRegistry";

export class RetentionError extends Error {}

function ensureLifecycle(
  record: { lifecycle?: import("./models").LifecycleMeta },
  category: RetentionCategory,
  anchor: string,
): import("./models").LifecycleMeta {
  return (
    record.lifecycle ?? {
      category,
      state: "within-retention" as const,
      anchor,
    }
  );
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

function liveSiteIdsUsing(state: StudyState, recordingId: string): Set<string> {
  const ids = new Set<string>();
  for (const site of state.sites) {
    if (
      site.recordingIds.includes(recordingId) &&
      siteRetention(site).state !== "archived"
    ) {
      ids.add(site.id);
    }
  }
  return ids;
}

export function canArchiveRecording(
  state: StudyState,
  recordingId: string,
): string | null {
  const recording = state.recordings.find((item) => item.id === recordingId);
  if (!recording) return "The selected clip no longer exists.";
  if (recordingRetention(recording).state === "archived")
    return "This clip is already archived.";
  const blockingSites = liveSiteIdsUsing(state, recordingId);
  if (blockingSites.size)
    return "Remove the clip from active listening sites before archiving it.";
  return null;
}

export function archiveRecording(
  state: StudyState,
  recordingId: string,
  at = new Date(),
): StudyState {
  const reason = canArchiveRecording(state, recordingId);
  if (reason) throw new RetentionError(reason);
  const timestamp = at.toISOString();
  return {
    ...state,
    recordings: state.recordings.map((recording) =>
      recording.id === recordingId
        ? {
            ...recording,
            lifecycle: {
              ...ensureLifecycle(
                recording,
                DEFAULT_RETENTION_CATEGORY.recording,
                recording.updatedAt,
              ),
              state: "archived",
              archivedAt: timestamp,
              restoredAt: undefined,
            },
          }
        : recording,
    ),
  };
}

export function restoreRecording(
  state: StudyState,
  recordingId: string,
  at = new Date(),
): StudyState {
  const recording = state.recordings.find((item) => item.id === recordingId);
  if (!recording) throw new RetentionError("The selected clip no longer exists.");
  const status = recordingRetention(recording, at);
  if (status.state !== "archived")
    throw new RetentionError("Only archived clips can be restored.");
  const timestamp = at.toISOString();
  // Restore re-arms the retention window from the restore instant. The restored
  // clip is a fresh piece of evidence and must earn release qualification again.
  const nextState =
    evaluateRetentionStatus(status.category, timestamp, undefined, at).state;
  return requalify({
    ...state,
    recordings: state.recordings.map((item) =>
      item.id === recordingId
        ? {
            ...item,
            lifecycle: {
              ...(item.lifecycle ?? status),
              state: nextState,
              anchor: timestamp,
              archivedAt: undefined,
              restoredAt: timestamp,
            },
          }
        : item,
    ),
  });
}

export function canPurgeRecording(
  state: StudyState,
  recordingId: string,
): string | null {
  const recording = state.recordings.find((item) => item.id === recordingId);
  if (!recording) return "The selected clip no longer exists.";
  const status = recordingRetention(recording);
  if (status.state !== "archived")
    return "Only archived clips can be purged; archive the clip first.";
  if (liveSiteIdsUsing(state, recordingId).size)
    return "The clip is still referenced by an active listening site.";
  if (releasesReferencingRecording(state, recordingId).length)
    return "A published release version still embeds this clip; retain it for lineage.";
  return null;
}

export function purgeRecording(
  state: StudyState,
  recordingId: string,
  at = new Date(),
  reason: RetentionTombstone["reason"] = "manual-purge",
): StudyState {
  const guard = canPurgeRecording(state, recordingId);
  if (guard) throw new RetentionError(guard);
  const recording = state.recordings.find((item) => item.id === recordingId);
  if (!recording) throw new RetentionError("The selected clip no longer exists.");
  const tombstone: RetentionTombstone = {
    id: recording.id,
    kind: "recording",
    label: recording.title,
    category:
      recording.lifecycle?.category ?? DEFAULT_RETENTION_CATEGORY.recording,
    purgedAt: at.toISOString(),
    reason,
    referencedByReleaseIds: releasesReferencingRecording(state, recording.id),
    importBatchId: recording.importBatchId,
  };
  return {
    ...state,
    recordings: state.recordings.filter((item) => item.id !== recordingId),
    // Route lists keep the id; resolution now serves the tombstone stub.
    issues: state.issues.filter((issue) => issue.recordingId !== recordingId),
    tombstones: dedupeTombstones([...state.tombstones, tombstone]),
  };
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export function canArchiveSite(state: StudyState, siteId: string): string | null {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) return "The selected site no longer exists.";
  if (siteRetention(site).state === "archived")
    return "This site is already archived.";
  return null;
}

function siteAnchor(site: Site): string {
  return site.lifecycle?.anchor ?? new Date(0).toISOString();
}

export function archiveSite(
  state: StudyState,
  siteId: string,
  at = new Date(),
): StudyState {
  const reason = canArchiveSite(state, siteId);
  if (reason) throw new RetentionError(reason);
  const timestamp = at.toISOString();
  return {
    ...state,
    sites: state.sites.map((site) =>
      site.id === siteId
        ? {
            ...site,
            lifecycle: {
              ...ensureLifecycle(site, DEFAULT_RETENTION_CATEGORY.site, siteAnchor(site)),
              state: "archived",
              archivedAt: timestamp,
              restoredAt: undefined,
            },
          }
        : site,
    ),
  };
}

export function restoreSite(
  state: StudyState,
  siteId: string,
  at = new Date(),
): StudyState {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) throw new RetentionError("The selected site no longer exists.");
  const status = siteRetention(site, at);
  if (status.state !== "archived")
    throw new RetentionError("Only archived sites can be restored.");
  const timestamp = at.toISOString();
  const nextState = evaluateRetentionStatus(
    status.category,
    timestamp,
    undefined,
    at,
  ).state;
  return requalify({
    ...state,
    sites: state.sites.map((item) =>
      item.id === siteId
        ? {
            ...item,
            lifecycle: {
              ...(item.lifecycle ?? status),
              state: nextState,
              anchor: timestamp,
              archivedAt: undefined,
              restoredAt: timestamp,
            },
          }
        : item,
    ),
  });
}

export function canPurgeSite(state: StudyState, siteId: string): string | null {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) return "The selected site no longer exists.";
  if (siteRetention(site).state !== "archived")
    return "Only archived sites can be purged; archive the site first.";
  return null;
}

export function purgeSite(
  state: StudyState,
  siteId: string,
  at = new Date(),
  reason: RetentionTombstone["reason"] = "manual-purge",
): StudyState {
  const block = canPurgeSite(state, siteId);
  if (block) throw new RetentionError(block);
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) throw new RetentionError("The selected site no longer exists.");
  const tombstone: RetentionTombstone = {
    id: site.id,
    kind: "site",
    label: site.name,
    category: site.lifecycle?.category ?? DEFAULT_RETENTION_CATEGORY.site,
    purgedAt: at.toISOString(),
    reason,
    referencedByReleaseIds: releaseIdsEmbeddingSite(state, site.id),
  };
  return {
    ...state,
    sites: state.sites.filter((item) => item.id !== siteId),
    issues: state.issues.filter((issue) => issue.siteId !== siteId),
    tombstones: dedupeTombstones([...state.tombstones, tombstone]),
  };
}

function releaseIdsEmbeddingSite(state: StudyState, siteId: string): string[] {
  const releases = [...(state.release ? [state.release] : []), ...(state.releaseHistory ?? [])];
  return releases
    .filter((release) => release.snapshot?.sites.some((site) => site.id === siteId))
    .map((release) => release.id);
}

// ---------------------------------------------------------------------------
// Quality findings
// ---------------------------------------------------------------------------

export function canArchiveIssue(state: StudyState, issueId: string): string | null {
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) return "The selected finding no longer exists.";
  if (issueRetention(issue).state === "archived")
    return "This finding is already archived.";
  return null;
}

export function archiveIssue(
  state: StudyState,
  issueId: string,
  at = new Date(),
): StudyState {
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) throw new RetentionError("The selected finding no longer exists.");
  if (issueRetention(issue).state === "archived")
    throw new RetentionError("This finding is already archived.");
  const timestamp = at.toISOString();
  return {
    ...state,
    issues: state.issues.map((item) =>
      item.id === issueId
        ? {
            ...item,
            lifecycle: {
              ...ensureLifecycle(item, DEFAULT_RETENTION_CATEGORY.issue, item.updatedAt),
              state: "archived",
              archivedAt: timestamp,
              restoredAt: undefined,
            },
          }
        : item,
    ),
  };
}

export function restoreIssue(
  state: StudyState,
  issueId: string,
  at = new Date(),
): StudyState {
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) throw new RetentionError("The selected finding no longer exists.");
  if (issueRetention(issue).state !== "archived")
    throw new RetentionError("Only archived findings can be restored.");
  const timestamp = at.toISOString();
  const nextState = evaluateRetentionStatus(
    DEFAULT_RETENTION_CATEGORY.issue,
    timestamp,
    undefined,
    at,
  ).state;
  return requalify({
    ...state,
    issues: state.issues.map((item) =>
      item.id === issueId
        ? {
            ...item,
            lifecycle: {
              ...(item.lifecycle ?? {
                category: DEFAULT_RETENTION_CATEGORY.issue,
                anchor: item.updatedAt,
              }),
              state: nextState,
              anchor: timestamp,
              archivedAt: undefined,
              restoredAt: timestamp,
            },
          }
        : item,
    ),
  });
}

export function canPurgeIssue(state: StudyState, issueId: string): string | null {
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) return "The selected finding no longer exists.";
  const status = issueRetention(issue);
  if (status.state !== "archived")
    return "Only archived findings can be purged; archive the finding first.";
  return null;
}

export function purgeIssue(
  state: StudyState,
  issueId: string,
  _at = new Date(),
): StudyState {
  const reason = canPurgeIssue(state, issueId);
  if (reason) throw new RetentionError(reason);
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) throw new RetentionError("The selected finding no longer exists.");
  // Findings have no inbound references, so no resolver tombstone is needed;
  // the audit log retains the evidence of the purge command.
  return {
    ...state,
    issues: state.issues.filter((item) => item.id !== issueId),
  };
}

// ---------------------------------------------------------------------------
// Import batches
// ---------------------------------------------------------------------------

export function archiveImportBatch(
  state: StudyState,
  batchId: string,
  at = new Date(),
): StudyState {
  if (!state.importBatches.some((batch) => batch.id === batchId))
    throw new RetentionError("The selected import batch no longer exists.");
  const timestamp = at.toISOString();
  return {
    ...state,
    importBatches: state.importBatches.map((batch) =>
      batch.id === batchId ? { ...batch, archivedAt: timestamp } : batch,
    ),
  };
}

export function restoreImportBatch(
  state: StudyState,
  batchId: string,
  _at = new Date(),
): StudyState {
  if (!state.importBatches.some((batch) => batch.id === batchId))
    throw new RetentionError("The selected import batch no longer exists.");
  return {
    ...state,
    importBatches: state.importBatches.map((batch) =>
      batch.id === batchId ? { ...batch, archivedAt: undefined } : batch,
    ),
  };
}

// ---------------------------------------------------------------------------
// Re-qualification after restore
// ---------------------------------------------------------------------------

/**
 * Restoring an archived record invalidates publication: the project returns
 * to review and any frozen release is marked stale, so a fresh readiness check
 * is mandatory before the restored material can ship.
 */
export function requalify(state: StudyState): StudyState {
  const stage = state.project.stage === "ready" ? "review" : state.project.stage;
  const release =
    state.release && state.release.status === "ready"
      ? { ...state.release, status: "stale" as const }
      : state.release;
  return {
    ...state,
    project: { ...state.project, stage },
    release,
  };
}

// ---------------------------------------------------------------------------
// Scheduled expiry sweep
// ---------------------------------------------------------------------------

export interface PurgeSweepResult {
  state: StudyState;
  archivedRecordings: number;
  archivedSites: number;
  archivedIssues: number;
  purgedRecordings: number;
  purgedSites: number;
  purgedIssues: number;
  skipped: string[];
}

/**
 * Execute the retention policy as of `at`:
 *  - expired, unreferenced clips / resolved findings are archived;
 *  - expired, empty sites are archived;
 *  - archived records past a second grace window (already archived) are purged
 *    when no release lineage still embeds them.
 *
 * Material protected by an active route or by a published release is skipped
 * and reported, never force-removed.
 */
export function runRetentionSweep(
  input: StudyState,
  at = new Date(),
): PurgeSweepResult {
  let state = input;
  const skipped: string[] = [];
  // Records archived before this sweep starts are the only purge candidates;
  // material that expires today is parked, not physically removed in the run
  // that first flags it. The next sweep purges it once nothing protects it.
  const previouslyArchivedRecordings = new Set(
    input.recordings
      .filter((recording) => recordingRetention(recording, at).state === "archived")
      .map((recording) => recording.id),
  );
  const previouslyArchivedSites = new Set(
    input.sites
      .filter((site) => siteRetention(site, at).state === "archived")
      .map((site) => site.id),
  );
  const previouslyArchivedIssues = new Set(
    input.issues
      .filter((issue) => issueRetention(issue, at).state === "archived")
      .map((issue) => issue.id),
  );
  let archivedRecordings = 0;
  let archivedSites = 0;
  let archivedIssues = 0;
  let purgedRecordings = 0;
  let purgedSites = 0;
  let purgedIssues = 0;

  // 1. Archive expired live material that is safe to park.
  for (const recording of [...state.recordings]) {
    const status = recordingRetention(recording, at);
    if (status.state !== "expired") continue;
    const block = canArchiveRecording(state, recording.id);
    if (block) {
      skipped.push(recording.id);
      continue;
    }
    state = archiveRecording(state, recording.id, at);
    archivedRecordings += 1;
  }
  for (const site of [...state.sites]) {
    const status = siteRetention(site, at);
    if (status.state !== "expired") continue;
    const block = canArchiveSite(state, site.id);
    if (block) {
      skipped.push(site.id);
      continue;
    }
    state = archiveSite(state, site.id, at);
    archivedSites += 1;
  }
  for (const issue of [...state.issues]) {
    const status = issueRetention(issue, at);
    if (status.state !== "expired" || issue.status !== "resolved") continue;
    state = archiveIssue(state, issue.id, at);
    archivedIssues += 1;
  }

  // 2. Purge records that were already archived when the sweep began, once
  //    they are unprotected by the route or release lineage.
  for (const recording of [...state.recordings]) {
    if (!previouslyArchivedRecordings.has(recording.id)) continue;
    const block = canPurgeRecording(state, recording.id);
    if (block) {
      skipped.push(recording.id);
      continue;
    }
    state = purgeRecording(state, recording.id, at, "expired-purge");
    purgedRecordings += 1;
  }
  for (const site of [...state.sites]) {
    if (!previouslyArchivedSites.has(site.id)) continue;
    const block = canPurgeSite(state, site.id);
    if (block) {
      skipped.push(site.id);
      continue;
    }
    state = purgeSite(state, site.id, at, "expired-purge");
    purgedSites += 1;
  }
  for (const issue of [...state.issues]) {
    if (!previouslyArchivedIssues.has(issue.id)) continue;
    const block = canPurgeIssue(state, issue.id);
    if (block) {
      skipped.push(issue.id);
      continue;
    }
    state = purgeIssue(state, issue.id, at);
    purgedIssues += 1;
  }

  return {
    state,
    archivedRecordings,
    archivedSites,
    archivedIssues,
    purgedRecordings,
    purgedSites,
    purgedIssues,
    skipped,
  };
}

export function retentionWindowLabel(category: RetentionCategory): string {
  return `${RETENTION_POLICY[category].retentionDays} days`;
}

function dedupeTombstones(tombstones: RetentionTombstone[]): RetentionTombstone[] {
  const map = new Map<string, RetentionTombstone>();
  for (const tombstone of tombstones) {
    const existing = map.get(tombstone.id);
    if (!existing || existing.kind !== tombstone.kind) {
      map.set(tombstone.id, tombstone);
    }
  }
  return [...map.values()];
}

export {
  recordingRetention,
  siteRetention,
  issueRetention,
  RETENTION_POLICY,
};
