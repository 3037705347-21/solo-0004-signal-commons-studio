import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { evaluateRelease } from "./releaseRules";
import { createSeedStudy } from "../state/seed";
import {
  BASELINE_RULES,
  fractionToPercent,
  percentToFraction,
  previewRuleImpact,
  selectActiveRuleVersion,
  validateRuleSet,
} from "./rules";
import type { RuleSet } from "./models";

const withRules = (overrides: Partial<RuleSet>): RuleSet => ({
  ...BASELINE_RULES,
  ...overrides,
});

describe("rule-set validation", () => {
  it("rejects thresholds outside a valid fraction range", () => {
    expect(
      validateRuleSet({ ...BASELINE_RULES, capacityWarnAt: 0 }),
    ).toHaveLength(1);
    expect(
      validateRuleSet({ ...BASELINE_RULES, capacityBlockAt: 1.4 }),
    ).toHaveLength(1);
  });

  it("rejects a warning threshold above the blocking threshold", () => {
    const errors = validateRuleSet(
      withRules({ capacityWarnAt: 0.95, capacityBlockAt: 0.8 }),
    );
    expect(errors[0].field).toBe("capacityWarnAt");
  });

  it("round trips percentage inputs through fractions", () => {
    expect(fractionToPercent(percentToFraction(85))).toBe(85);
  });
});

describe("rules drive route analysis", () => {
  it("treats sensitive clips at non-quiet sites per the active policy", () => {
    const state = createSeedStudy();
    // rec-park is sensitive and unplaced; put it at a non-quiet site.
    const sites = state.sites.map((site) =>
      site.id === "site-threshold"
        ? { ...site, recordingIds: ["rec-park"] }
        : site,
    );

    const warning = analyzeRoute(state.recordings, sites, BASELINE_RULES);
    const quietFinding = warning.findings.find(
      (finding) => finding.id === "quiet-rec-park-site-threshold",
    );
    expect(quietFinding?.type).toBe("warning");

    const blocked = analyzeRoute(
      state.recordings,
      sites,
      withRules({ sensitivePolicy: "block-placement" }),
    );
    expect(
      blocked.findings.find(
        (finding) => finding.id === "quiet-rec-park-site-threshold",
      )?.type,
    ).toBe("error");

    const allowed = analyzeRoute(
      state.recordings,
      sites,
      withRules({ sensitivePolicy: "allow" }),
    );
    expect(
      allowed.findings.some((finding) =>
        finding.id.startsWith("quiet-rec-park"),
      ),
    ).toBe(false);
  });

  it("warns at a configurable capacity ratio", () => {
    const state = createSeedStudy();
    // Threshold has 154s planned against a 420s target (~37%).
    const tight = withRules({ capacityWarnAt: 0.3 });
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      tight,
    );
    expect(
      analysis.findings.some((finding) => finding.id === "pressure-site-threshold"),
    ).toBe(true);

    const loose = analyzeRoute(
      state.recordings,
      state.sites,
      withRules({ capacityWarnAt: 0.8 }),
    );
    expect(
      loose.findings.some((finding) => finding.id === "pressure-site-threshold"),
    ).toBe(false);
  });
});

describe("release gate thresholds", () => {
  it("can relax the feature-coverage gate for a study", () => {
    const state = createSeedStudy();
    const sites = state.sites.map((site) =>
      site.id === "site-voices" ? { ...site, recordingIds: [] } : site,
    );
    const strict = analyzeRoute(state.recordings, sites, BASELINE_RULES);
    expect(evaluateRelease(state, strict, new Date(), BASELINE_RULES).blockers.join(" ")).toMatch(
      /featured clip/i,
    );

    const relaxedRules = withRules({
      requireFeaturedPlaced: false,
      requireCriticalResolved: false,
    });
    // Featured unplaced finding becomes a notice under relaxed rules.
    const relaxedAnalysis = analyzeRoute(state.recordings, sites, relaxedRules);
    const result = evaluateRelease(
      { ...state, issues: [] },
      relaxedAnalysis,
      new Date(),
      relaxedRules,
    );
    expect(result.blockers.join(" ")).not.toMatch(/featured clip/i);
  });
});

describe("rule impact preview", () => {
  it("reports sites and release gate changes before adoption", () => {
    const state = createSeedStudy();
    const candidate = withRules({ capacityWarnAt: 0.3 });
    const preview = previewRuleImpact(state, candidate);

    expect(preview.beforeAnalysis).not.toBe(preview.afterAnalysis);
    expect(preview.affectedSiteCount).toBeGreaterThan(0);
    expect(preview.items.some((item) => item.kind === "site")).toBe(true);
    // The seed study is blocked under every version here, but blocker counts
    // shift as capacity warnings appear.
    expect(preview.afterRelease.ready).toBe(false);
  });

  it("flags each sensitive recording when the policy tightens", () => {
    const state = createSeedStudy();
    const sites = state.sites.map((site) =>
      site.id === "site-return"
        ? { ...site, quietSpace: false, recordingIds: ["rec-park"] }
        : site,
    );
    const study = { ...state, sites };
    const preview = previewRuleImpact(
      study,
      withRules({ sensitivePolicy: "block-placement" }),
    );
    const recording = preview.items.find(
      (item) => item.kind === "recording" && item.id === "rec-park",
    );
    expect(recording?.status).toBe("new-blocker");
  });

  it("shows no change when candidate rules equal the active version", () => {
    const state = createSeedStudy();
    const preview = previewRuleImpact(state, selectActiveRuleVersion(state).rules);
    expect(preview.items).toHaveLength(0);
    expect(preview.releaseChanges).toBe(false);
  });
});
