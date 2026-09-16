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
import { captureReleaseContent } from "./releaseHistory";

function freezeRelease(record: ReleaseRecord): ReleaseRecord {
  if (record.content) Object.freeze(record.content);
  if (record.snapshot) Object.freeze(record.snapshot);
  return Object.freeze(record);
}
export function evaluateRelease(
  state: StudyState,
  analysis: RouteAnalysis,
  at = new Date(),
): ReleaseResult {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const critical = state.issues.filter(
    (issue) => issue.severity === "critical" && issue.status !== "resolved",
  );
  const warnings = state.issues.filter(
    (issue) => issue.severity === "warning" && issue.status !== "resolved",
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
  const byId = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
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
      recordingCount: state.recordings.length,
      siteCount: state.sites.length,
      routeSeconds: analysis.totalDurationSeconds,
      readinessScore: readiness.score,
    },
    sites: state.sites
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
      (issue) => issue.status !== "resolved",
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
  // A new check supersedes the previous head, whether that check passed or not.
  const supersedes =
    state.releaseHistory.at(-1)?.id ?? state.release?.id;
  const content = captureReleaseContent(state, readiness.checkedAt);
  const snapshot = readiness.ready
    ? buildReleaseSnapshot(
        state,
        analysis,
        readiness,
        releaseId,
        releaseSequence,
      )
    : undefined;
  const record: ReleaseRecord = {
    id: releaseId,
    sequence: releaseSequence,
    createdAt: readiness.checkedAt,
    status: readiness.ready ? "ready" : "blocked",
    revision: state.revision,
    fingerprint: snapshot?.fingerprint ?? releaseFingerprint(state),
    supersedes,
    readiness,
    snapshot,
    content,
  };
  return freezeRelease(record);
}

export function isReleaseCurrent(
  state: StudyState,
  release: ReleaseRecord | null | undefined,
): release is ReleaseRecord & { status: "ready"; snapshot: Snapshot } {
  // A draft forked from history never revives the release it was copied from;
  // a fresh readiness check must clear draftSourceReleaseId before publishing.
  if (state.draftSourceReleaseId) return false;
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
