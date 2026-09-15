import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { createSeedStudy } from "../state/seed";
describe("route analysis", () => {
  it("reports featured clips that are unplaced", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites.map((site) =>
        site.id === "site-voices" ? { ...site, recordingIds: [] } : site,
      ),
    );
    expect(analysis.featuredCoverage).toBeLessThan(1);
    expect(analysis.blockingCount).toBeGreaterThan(0);
  });

  it("emits one stable clip-limit finding for repeated overflow", () => {
    const state = createSeedStudy();
    const site = {
      ...state.sites[0],
      maxClips: 1,
      recordingIds: ["rec-market", "rec-tram", "rec-workshop"],
    };
    const analysis = analyzeRoute(state.recordings, [site]);
    const clipLimitFindings = analysis.findings.filter(
      (finding) => finding.id === `clip-limit-${site.id}`,
    );
    expect(clipLimitFindings).toHaveLength(1);
    expect(clipLimitFindings[0].detail).toContain("3 clips");
  });
});
