import { createId } from "./ids";
import { evaluateRelease } from "./releaseRules";
import { analyzeRoute } from "./routeAnalysis";
import type {
  PendingRuleChange,
  RuleImpactItem,
  RuleImpactPreview,
  RuleSet,
  RuleVersion,
  StudyState,
  ValidationError,
} from "./models";

export const BASELINE_RULE_ID = "rules-2026-baseline";
export const BASELINE_EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";
export const BASELINE_RULE_LABEL = "Field season 2026 baseline";

/**
 * The rules originally baked into the workspace. This preserves the exact
 * behaviour every pre-versioning study was evaluated under, so reopening an
 * old project interprets it under its historical basis instead of today's.
 */
export const BASELINE_RULES: RuleSet = {
  capacityWarnAt: 0.8,
  capacityBlockAt: 1,
  maxClipSeconds: 900,
  sensitivePolicy: "review-warning",
  requireFeaturedPlaced: true,
  requireAllRoles: true,
  requireCriticalResolved: true,
  requireNonEmptyRoute: true,
};

export function createBaselineRuleVersion(): RuleVersion {
  return {
    id: BASELINE_RULE_ID,
    label: BASELINE_RULE_LABEL,
    note: "Capacity, sensitive-audio, and release thresholds in force before per-study rule versioning.",
    rules: structuredClone(BASELINE_RULES),
    effectiveFrom: BASELINE_EFFECTIVE_FROM,
  };
}

export function createRuleVersion(
  rules: RuleSet,
  label: string,
  note: string,
  at = new Date(),
): RuleVersion {
  const timestamp = at.toISOString();
  return {
    id: createId("rules"),
    label: label.trim(),
    note: note.trim(),
    rules: structuredClone(rules),
    effectiveFrom: timestamp,
    adoptedAt: timestamp,
  };
}

export function selectActiveRuleVersion(state: StudyState): RuleVersion {
  const active =
    state.ruleVersions.find(
      (version) => version.id === state.activeRuleVersionId,
    ) ?? state.ruleVersions[state.ruleVersions.length - 1];
  if (!active)
    throw new Error("Every study must carry at least one rule version.");
  return active;
}

export function selectRuleVersion(
  state: StudyState,
  ruleVersionId: string,
): RuleVersion | undefined {
  return state.ruleVersions.find((version) => version.id === ruleVersionId);
}

const isFraction = (value: number) =>
  Number.isFinite(value) && value > 0 && value <= 1;

export function validateRuleSet(
  draft: Partial<RuleSet>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isFraction(draft.capacityWarnAt as number))
    errors.push({
      field: "capacityWarnAt",
      message: "The warning threshold must be a percentage above 0%.",
    });
  if (!isFraction(draft.capacityBlockAt as number))
    errors.push({
      field: "capacityBlockAt",
      message: "The blocking threshold must be a percentage above 0%.",
    });
  if (
    isFraction(draft.capacityWarnAt as number) &&
    isFraction(draft.capacityBlockAt as number) &&
    (draft.capacityWarnAt as number) > (draft.capacityBlockAt as number)
  )
    errors.push({
      field: "capacityWarnAt",
      message: "The warning threshold cannot exceed the blocking threshold.",
    });
  if (
    !Number.isFinite(draft.maxClipSeconds as number) ||
    (draft.maxClipSeconds as number) <= 0
  )
    errors.push({
      field: "maxClipSeconds",
      message: "Clip length must be a positive number of seconds.",
    });
  if (
    draft.sensitivePolicy !== "allow" &&
    draft.sensitivePolicy !== "review-warning" &&
    draft.sensitivePolicy !== "block-placement"
  )
    errors.push({
      field: "sensitivePolicy",
      message: "Choose how sensitive clips are handled at non-quiet sites.",
    });
  return errors;
}

export function validateRuleChange(
  pending: Pick<PendingRuleChange, "label" | "note" | "rules">,
): ValidationError[] {
  const errors = validateRuleSet(pending.rules);
  if (!pending.label.trim())
    errors.push({ field: "label", message: "Name this rule version." });
  if (pending.note.trim().length < 12)
    errors.push({
      field: "note",
      message: "Explain why the thresholds are changing (at least 12 chars).",
    });
  return errors;
}

/** Convert a validated percentage input (e.g. 85) into a stored fraction. */
export const percentToFraction = (percent: string | number): number =>
  Math.round(Number(percent) * 10) / 1000;

export const fractionToPercent = (fraction: number): number =>
  Math.round(fraction * 100);

const SITE_STATUS_PRIORITY: Record<RuleImpactItem["status"], number> = {
  "new-blocker": 4,
  "cleared-blocker": 3,
  "new-warning": 2,
  "cleared-warning": 1,
  unchanged: 0,
};

const worseStatus = (
  left: RuleImpactItem["status"],
  right: RuleImpactItem["status"],
): RuleImpactItem["status"] =>
  SITE_STATUS_PRIORITY[left] >= SITE_STATUS_PRIORITY[right] ? left : right;

const deltaStatus = (
  before: boolean,
  after: boolean,
  kind: "blocker" | "warning",
): RuleImpactItem["status"] => {
  if (!before && after)
    return kind === "blocker" ? "new-blocker" : "new-warning";
  if (before && !after)
    return kind === "blocker" ? "cleared-blocker" : "cleared-warning";
  return "unchanged";
};

const describeSiteDelta = (
  beforeBlocking: number,
  afterBlocking: number,
  beforeWarnings: number,
  afterWarnings: number,
): string => {
  const parts: string[] = [];
  if (beforeBlocking !== afterBlocking)
    parts.push(`blocking findings ${beforeBlocking} → ${afterBlocking}`);
  if (beforeWarnings !== afterWarnings)
    parts.push(`warnings ${beforeWarnings} → ${afterWarnings}`);
  if (!parts.length) return "Constraint counts are unchanged.";
  return parts.join(" · ") + ".";
};

const recordingSiteName = (state: StudyState, siteId: string): string =>
  state.sites.find((site) => site.id === siteId)?.shortLabel ?? siteId;

const impactedRecordingIds = (state: StudyState): Set<string> => {
  const ids = new Set<string>();
  state.sites.forEach((site) => {
    if (!site.quietSpace)
      site.recordingIds.forEach((id) => ids.add(id));
  });
  return ids;
};

/**
 * Compare the current study under its active rules and a candidate rule set.
 * Pure and non-mutating so the lead can review the blast radius before the
 * draft is adopted.
 */
export function previewRuleImpact(
  state: StudyState,
  candidateRules: RuleSet,
  at = new Date(),
): RuleImpactPreview {
  const active = selectActiveRuleVersion(state);
  const beforeAnalysis = analyzeRoute(
    state.recordings,
    state.sites,
    active.rules,
  );
  const afterAnalysis = analyzeRoute(
    state.recordings,
    state.sites,
    candidateRules,
  );
  const beforeRelease = evaluateRelease(state, beforeAnalysis, at, active.rules);
  const afterRelease = evaluateRelease(state, afterAnalysis, at, candidateRules);

  const beforeBySite = new Map(
    beforeAnalysis.sites.map((site) => [site.siteId, site]),
  );
  const affectedSites = new Set<string>();
  const siteItems: RuleImpactItem[] = [];
  afterAnalysis.sites.forEach((after) => {
    const before = beforeBySite.get(after.siteId);
    if (!before) return;
    const beforeBlocking = before.findings.filter(
      (finding) => finding.type === "error",
    ).length;
    const afterBlocking = after.findings.filter(
      (finding) => finding.type === "error",
    ).length;
    const beforeWarnings = before.findings.filter(
      (finding) => finding.type === "warning",
    ).length;
    const afterWarnings = after.findings.filter(
      (finding) => finding.type === "warning",
    ).length;
    const blockingStatus = deltaStatus(
      beforeBlocking > 0,
      afterBlocking > 0,
      "blocker",
    );
    const warningStatus = deltaStatus(
      beforeWarnings > 0,
      afterWarnings > 0,
      "warning",
    );
    const status = worseStatus(blockingStatus, warningStatus);
    if (status === "unchanged") return;
    affectedSites.add(after.siteId);
    siteItems.push({
      kind: "site",
      id: after.siteId,
      label: recordingSiteName(state, after.siteId),
      status,
      detail: describeSiteDelta(
        beforeBlocking,
        afterBlocking,
        beforeWarnings,
        afterWarnings,
      ),
    });
  });

  // Sensitive-audio rule changes affect clips already placed at non-quiet
  // sites; list each one so the lead sees which recordings change status.
  const affectedRecordings = new Set<string>();
  const recordingItems: RuleImpactItem[] = [];
  if (active.rules.sensitivePolicy !== candidateRules.sensitivePolicy) {
    const severityOf = (policy: RuleSet["sensitivePolicy"]) =>
      policy === "block-placement"
        ? "error"
        : policy === "review-warning"
          ? "warning"
          : "none";
    const beforeSev = severityOf(active.rules.sensitivePolicy);
    const afterSev = severityOf(candidateRules.sensitivePolicy);
    if (beforeSev !== afterSev) {
      impactedRecordingIds(state).forEach((recordingId) => {
        const recording = state.recordings.find(
          (candidate) => candidate.id === recordingId,
        );
        const site = state.sites.find((candidate) =>
          candidate.recordingIds.includes(recordingId),
        );
        if (!recording || !site || recording.sensitivity !== "sensitive")
          return;
        const rank: Record<string, number> = {
          none: 0,
          warning: 1,
          error: 2,
        };
        const status: RuleImpactItem["status"] =
          rank[afterSev] > rank[beforeSev]
            ? afterSev === "error"
              ? "new-blocker"
              : "new-warning"
            : afterSev === "error"
              ? "cleared-warning"
              : beforeSev === "error"
                ? "cleared-blocker"
                : "cleared-warning";
        affectedRecordings.add(recordingId);
        recordingItems.push({
          kind: "recording",
          id: recordingId,
          label: recording.title,
          status,
          detail: `${recordingSiteName(state, site.id)} · sensitive playback becomes ${
            afterSev === "none" ? "allowed" : afterSev === "warning" ? "reviewed with a warning" : "blocked"
          }.`,
        });
      });
    }
  }

  // Clip-length rule changes flag recordings that cross the library limit.
  if (active.rules.maxClipSeconds !== candidateRules.maxClipSeconds) {
    state.recordings.forEach((recording) => {
      const beforeTooLong =
        recording.audioSpec.durationSeconds > active.rules.maxClipSeconds;
      const afterTooLong =
        recording.audioSpec.durationSeconds > candidateRules.maxClipSeconds;
      if (beforeTooLong === afterTooLong) return;
      affectedRecordings.add(recording.id);
      recordingItems.push({
        kind: "recording",
        id: recording.id,
        label: recording.title,
        status: afterTooLong ? "new-blocker" : "cleared-blocker",
        detail: `${Math.round(recording.audioSpec.durationSeconds / 60)} min clip is ${afterTooLong ? "now over" : "back within"} the ${Math.round(candidateRules.maxClipSeconds / 60)} minute limit.`,
      });
    });
  }

  const releaseStatus: RuleImpactItem["status"] =
    beforeRelease.ready === afterRelease.ready
      ? beforeRelease.blockers.length === afterRelease.blockers.length &&
        beforeRelease.cautions.length === afterRelease.cautions.length
        ? "unchanged"
        : afterRelease.blockers.length > beforeRelease.blockers.length
          ? "new-warning"
          : "cleared-warning"
      : afterRelease.ready
        ? "cleared-blocker"
        : "new-blocker";
  const releaseItems: RuleImpactItem[] =
    releaseStatus === "unchanged"
      ? []
      : [
          {
            kind: "release",
            id: "release-gate",
            label: "Release gate",
            status: releaseStatus,
            detail: afterRelease.ready
              ? `The gate passes under the draft (score ${afterRelease.score}).`
              : `${afterRelease.blockers.length} blocker${afterRelease.blockers.length === 1 ? "" : "s"} under the draft (score ${afterRelease.score}).`,
          },
        ];

  const items = [...siteItems, ...recordingItems, ...releaseItems].sort(
    (left, right) =>
      SITE_STATUS_PRIORITY[right.status] - SITE_STATUS_PRIORITY[left.status],
  );

  return {
    beforeAnalysis,
    afterAnalysis,
    beforeRelease,
    afterRelease,
    items,
    affectedSiteCount: affectedSites.size,
    affectedRecordingCount: affectedRecordings.size,
    releaseChanges: releaseStatus !== "unchanged",
  };
}
