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
});
