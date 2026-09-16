import { buildConsentBasis } from "./consent";
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

/** Route findings that are not consent-derived. */
function isStructuralFinding(id: string): boolean {
  return !id.startsWith("consent-");
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
  const consentErrors = analysis.findings.filter(
    (finding) => finding.type === "error" && !isStructuralFinding(finding.id),
  );
  const structuralBlocking = analysis.blockingCount - consentErrors.length;
  if (structuralBlocking > 0)
    blockers.push(
      `${structuralBlocking} route constraint${structuralBlocking === 1 ? "" : "s"} remain.`,
    );
  const uniqueConsentErrors = new Map(
    consentErrors.map((finding) => [finding.recordingId ?? finding.id, finding]),
  );
  if (uniqueConsentErrors.size)
    blockers.push(
      `${uniqueConsentErrors.size} placed clip${uniqueConsentErrors.size === 1 ? "" : "s"} lack usable route consent and cannot be released.`,
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
  const archiveGaps = analysis.findings.filter(
    (finding) => finding.id.startsWith("consent-archive-"),
  );
  if (archiveGaps.length)
    cautions.push(
      `${archiveGaps.length} placed clip${archiveGaps.length === 1 ? " is" : "s are"} cleared for the route but not for the public study archive.`,
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
  at = new Date(),
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
          )
          .map((recording) => {
            // Freeze the consent basis under which this released clip shipped.
            const basis = buildConsentBasis(
              recording.id,
              state.consents,
              at,
            );
            return basis ? { ...recording, consentBasis: basis } : recording;
          }),
      })),
    consents: state.consents.map((grant) => structuredClone(grant)),
    unresolvedIssues: state.issues.filter(
      (issue) => issue.status !== "resolved",
    ),
  };
}

export function createReleaseRecord(
  state: StudyState,
  analysis: RouteAnalysis,
  readiness: ReleaseResult,
  at = new Date(),
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
        at,
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
