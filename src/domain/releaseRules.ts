import type {
  QualityIssue,
  ReleaseResult,
  RouteAnalysis,
  Snapshot,
  StudyState,
} from "./models";
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
): Snapshot {
  if (!readiness.ready)
    throw new Error(
      "A snapshot can only be created after readiness checks pass.",
    );
  const byId = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
  return {
    schemaVersion: 1,
    generatedAt: readiness.checkedAt,
    project: {
      ...state.project,
      stage: "ready",
      lastReadinessCheck: readiness.checkedAt,
    },
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
export function issueProgress(issues: QualityIssue[]): number {
  return issues.length
    ? issues.filter((issue) => issue.status === "resolved").length /
        issues.length
    : 1;
}
