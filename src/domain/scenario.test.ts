import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { clampScenario, projectScenario } from "./scenario";
import { createSeedStudy } from "../state/seed";
describe("scenario projection", () => {
  it("clamps listener inputs", () =>
    expect(
      clampScenario({ pace: "steady", accessPriority: 200, listenerCount: 0 }),
    ).toEqual({ pace: "steady", accessPriority: 100, listenerCount: 1 }));
  it("does not mutate preferences", () => {
    const state = createSeedStudy();
    const before = JSON.stringify(state.preferences);
    expect(
      projectScenario(state, analyzeRoute(state.recordings, state.sites), {
        pace: "deep",
        accessPriority: 90,
        listenerCount: 18,
      }).durationSeconds,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(state.preferences)).toBe(before);
  });
});
