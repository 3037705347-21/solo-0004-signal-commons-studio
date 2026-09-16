import type {
  QualityIssue,
  ReleaseResult,
  ReleaseRecord,
  RouteAnalysis,
  RuleSet,
  Snapshot,
  StudyState,
} from "./models";
import { createId } from "./ids";
import { releaseFingerprint } from "./releaseIdentity";
import { selectActiveRuleVersion } from "./rules";

export function evaluateRelease(
  state: StudyState,
  analysis: RouteAnalysis,
  at: Date = new Date(),
  rules: RuleSet = selectActiveRuleVersion(state).rules,
): ReleaseResult {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const critical = state.issues.filter(
    (issue) => issue.severity === "critical" && issue.status !== "resolved",
  );
  const warnings = state.issues.filter(
    (issue) => issue.severity === "warning" && issue.status !== "resolved",
  );
  if (rules.requireNonEmptyRoute && !analysis.placedCount)
    blockers.push("The listening route has no clips.");
  if (analysis.blockingCount)
    blockers.push(
      `${analysis.blockingCount} route constraint${analysis.blockingCount === 1 ? "" : "s"} remain.`,
    );
  if (rules.requireCriticalResolved && critical.length)
    blockers.push(
      `${critical.length} critical consent or editorial finding${critical.length === 1 ? "" : "s"} remain unresolved.`,
    );
  if (rules.requireFeaturedPlaced && analysis.featuredCoverage < 1)
    blockers.push("Every featured clip must be assigned to a listening site.");
  if (rules.requireAllRoles && analysis.roleCoverage < 1)
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
  ruleVersion = selectActiveRuleVersion(state),
): Snapshot {
  if (!readiness.ready)
    throw new Error(
      "A snapshot can only be created after readiness checks pass.",
    );
  const byId = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
  return {
    schemaVersion: 3,
    generatedAt: readiness.checkedAt,
    releaseId,
    releaseSequence,
    revision: state.revision,
    fingerprint: releaseFingerprint(state),
    ruleVersion: {
      id: ruleVersion.id,
      label: ruleVersion.label,
      note: ruleVersion.note,
      rules: structuredClone(ruleVersion.rules),
      effectiveFrom: ruleVersion.effectiveFrom,
    },
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
  ruleVersion = selectActiveRuleVersion(state),
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
        ruleVersion,
      )
    : undefined;
  return {
    id: releaseId,
    sequence: releaseSequence,
    createdAt: readiness.checkedAt,
    status: readiness.ready ? "ready" : "blocked",
    revision: state.revision,
    fingerprint: snapshot?.fingerprint ?? releaseFingerprint(state),
    ruleVersionId: ruleVersion.id,
    ruleLabel: ruleVersion.label,
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
    release.ruleVersionId === state.activeRuleVersionId &&
    release.fingerprint === releaseFingerprint(state)
  );
}

export function issueProgress(issues: QualityIssue[]): number {
  return issues.length
    ? issues.filter((issue) => issue.status === "resolved").length /
        issues.length
    : 1;
}
