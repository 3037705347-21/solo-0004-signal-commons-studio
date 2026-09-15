import { describe, expect, it } from "vitest";
import { releaseFingerprint } from "./releaseIdentity";
import { createSeedStudy } from "../state/seed";

describe("release fingerprint", () => {
  it("is stable across irrelevant collection ordering", () => {
    const state = createSeedStudy();
    const reordered = {
      ...state,
      recordings: [...state.recordings].reverse(),
      sites: [...state.sites].reverse(),
      issues: [...state.issues].reverse(),
    };
    expect(releaseFingerprint(reordered)).toBe(releaseFingerprint(state));
  });

  it("changes when a release-relevant domain value changes", () => {
    const state = createSeedStudy();
    const changed = {
      ...state,
      issues: state.issues.map((issue, index) =>
        index === 0 ? { ...issue, severity: "warning" as const } : issue,
      ),
    };
    expect(releaseFingerprint(changed)).not.toBe(releaseFingerprint(state));
  });
});
