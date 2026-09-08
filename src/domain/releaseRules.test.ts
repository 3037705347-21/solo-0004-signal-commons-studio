import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { evaluateRelease } from "./releaseRules";
import type { RouteAnalysis } from "./models";
import { createSeedStudy } from "../state/seed";

describe("release rules", () => {
  it("blocks release while featured clips or consent findings remain open", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(state.recordings, state.sites);
    const result = evaluateRelease(state, analysis);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/featured clip/);
    expect(result.blockers.join(" ")).toMatch(/critical consent/);
  });

  it("requires every signal role to be represented in the route", () => {
    const state = createSeedStudy();
    const analysis: RouteAnalysis = {
      totalDurationSeconds: 100,
      placedCount: 3,
      unplacedCount: 0,
      featuredCoverage: 1,
      roleCoverage: 0.75,
      sites: [],
      findings: [],
      blockingCount: 0,
      warningCount: 0,
    };
    const blocker = evaluateRelease(
      { ...state, issues: [] },
      analysis,
    ).blockers.join(" ");
    expect(blocker).toMatch(/arrival, texture, voice, and departure/);
  });
});
