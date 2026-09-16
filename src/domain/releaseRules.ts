import type {
  QualityIssue,
  ReleaseResult,
  ReleaseRecord,
  RouteAnalysis,
  Snapshot,
  StudyState,
} from "./models";
import { createId } from "./ids";
import { releaseFingerprint } from "./releaseIdentity";
import {
  isLiveSite,
  releasesReferencingRecording,
} from "./retentionRegistry";
import { recordingRetention, siteRetention } from "./retention";

export function evaluateRelease(
  state: StudyState,
  analysis: RouteAnalysis,
  at = new Date(),
): ReleaseResult {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const critical = state.issues.filter(
    (issue) =>
      issue.severity === "critical" &&
      issue.status !== "resolved" &&
      issue.lifecycle?.state !== "archived",
  );
  const warnings = state.issues.filter(
    (issue) =>
      issue.severity === "warning" &&
      issue.status !== "resolved" &&
      issue.lifecycle?.state !== "archived",
  );
  if (analysis.blockingCount)
    blockers.push(
      `${analysis.blockingCount} route constraint${analysis.blockingCount === 1 ? "" : "s"} remain.`,
    );
  if (critical.length)
    blockers.push(
      `${critical.length} critical consent or editorial finding${critical.length === 1 ? "" : "s"} remain unresolved.`,
    );
  if (!analysis.placedCount) blockers.push("The listening route has no clips.");
  if (analysis.featuredCoverage < 1)
    blockers.push("Every featured clip must be assigned to a listening site.");
  if (analysis.roleCoverage < 1)
    blockers.push(
      "The route should include arrival, texture, voice, and departure signals.",
    );

  // Retention gate: archived material must not ship, and any material
  // restored after the last successful check must re-earn qualification. The
  // restoredAt timestamp is what proves a fresh check is still missing.
  const lastCheck = state.project.lastReadinessCheck;
  const restoredLiveRecordings = state.recordings.filter(
    (recording) =>
      recording.lifecycle?.restoredAt &&
      (!lastCheck || recording.lifecycle.restoredAt > lastCheck),
  );
  if (restoredLiveRecordings.length)
    blockers.push(
      `${restoredLiveRecordings.length} restored clip${restoredLiveRecordings.length === 1 ? "" : "s"} must pass a fresh readiness check before release.`,
    );
  const restoredSites = state.sites.filter(
    (site) =>
      site.lifecycle?.restoredAt &&
      (!lastCheck || site.lifecycle.restoredAt > lastCheck),
  );
  if (restoredSites.length)
    blockers.push(
      `${restoredSites.length} restored site${restoredSites.length === 1 ? "" : "s"} must be re-reviewed before release.`,
    );

  // Cleaned references: a route citation landing on a purged tombstone means
  // the frozen lineage changed and blocks release until the route is repaired.
  const purgedCitations = state.sites
    .filter((site) => isLiveSite(state, site.id))
    .flatMap((site) =>
      site.recordingIds.filter(
        (id) =>
          !state.recordings.some((recording) => recording.id === id) &&
          !releasesReferencingRecording(state, id).length,
      ),
    );
  if (purgedCitations.length)
    blockers.push(
      `${purgedCitations.length} route reference${purgedCitations.length === 1 ? "" : "s"} point to purged material; repair the route before release.`,
    );

  const archivedOnRoute = state.sites
    .filter((site) => siteRetention(site).state !== "archived")
    .flatMap((site) => site.recordingIds)
    .filter((id) => {
      const recording = state.recordings.find((item) => item.id === id);
      return recording && recordingRetention(recording).state === "archived";
    });
  if (archivedOnRoute.length)
    blockers.push(
      `${archivedOnRoute.length} archived clip${archivedOnRoute.length === 1 ? "" : "s"} still occupy the route.`,
    );

  if (analysis.warningCount)
    cautions.push(
      `${analysis.warningCount} route warning${analysis.warningCount === 1 ? "" : "s"} should be reviewed.`,
    );
  if (warnings.length)
    cautions.push(
      `${warnings.length} non-critical finding${warnings.length === 1 ? "" : "s"} remain open.`,
    );
  if (analysis.unplacedCount)
    cautions.push(
      `${analysis.unplacedCount} clip${analysis.unplacedCount === 1 ? "" : "s"} are not used in the route.`,
    );
  const score = Math.max(
    0,
    Math.min(100, 100 - blockers.length * 18 - cautions.length * 6),
  );
  return {
    ready: blockers.length === 0,
    score: Math.round(score),
    blockers,
    cautions,
    checkedAt: at.toISOString(),
  };
}

/** Live (non-archived) recordings only drive route analysis and snapshots. */
export function liveRecordings(state: StudyState) {
  return state.recordings.filter(
    (recording) => recordingRetention(recording).state !== "archived",
  );
}

/** Live (non-archived) sites only drive route analysis and snapshots. */
export function liveSites(state: StudyState) {
  return state.sites.filter((site) => siteRetention(site).state !== "archived");
}
export function buildReleaseSnapshot(
  state: StudyState,
  analysis: RouteAnalysis,
  readiness: ReleaseResult,
  releaseId: string,
  releaseSequence: number,
): Snapshot {
  if (!readiness.ready)
    throw new Error(
      "A snapshot can only be created after readiness checks pass.",
    );
  const activeRecordings = liveRecordings(state);
  const activeSites = liveSites(state);
  const byId = new Map(activeRecordings.map((recording) => [recording.id, recording]));
  return {
    schemaVersion: 2,
    generatedAt: readiness.checkedAt,
    releaseId,
    releaseSequence,
    revision: state.revision,
    fingerprint: releaseFingerprint(state),
    project: {
      ...state.project,
      stage: "ready",
      lastReadinessCheck: readiness.checkedAt,
    },
    preferences: state.preferences,
    summary: {
      recordingCount: activeRecordings.length,
      siteCount: activeSites.length,
      routeSeconds: analysis.totalDurationSeconds,
      readinessScore: readiness.score,
    },
    sites: activeSites
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((site) => ({
        ...site,
        recordings: site.recordingIds
          .map((id) => byId.get(id))
          .filter((recording): recording is NonNullable<typeof recording> =>
            Boolean(recording),
          ),
      })),
    unresolvedIssues: state.issues.filter(
      (issue) =>
        issue.status !== "resolved" && issue.lifecycle?.state !== "archived",
    ),
  };
}

export function createReleaseRecord(
  state: StudyState,
  analysis: RouteAnalysis,
  readiness: ReleaseResult,
): ReleaseRecord {
  const releaseId = createId("release");
  const releaseSequence = (state.release?.sequence ?? 0) + 1;
  const snapshot = readiness.ready
    ? buildReleaseSnapshot(
        state,
        analysis,
        readiness,
        releaseId,
        releaseSequence,
      )
    : undefined;
  return {
    id: releaseId,
    sequence: releaseSequence,
    createdAt: readiness.checkedAt,
    status: readiness.ready ? "ready" : "blocked",
    revision: state.revision,
    fingerprint: snapshot?.fingerprint ?? releaseFingerprint(state),
    supersedes: state.release?.id,
    readiness,
    snapshot,
  };
}

export function isReleaseCurrent(
  state: StudyState,
  release: ReleaseRecord | null | undefined,
): release is ReleaseRecord & { status: "ready"; snapshot: Snapshot } {
  return (
    release?.status === "ready" &&
    Boolean(release.snapshot) &&
    release.fingerprint === releaseFingerprint(state)
  );
}

export function issueProgress(issues: QualityIssue[]): number {
  return issues.length
    ? issues.filter((issue) => issue.status === "resolved").length /
        issues.length
    : 1;
}
