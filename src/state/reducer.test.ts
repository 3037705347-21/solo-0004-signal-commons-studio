import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { createReleaseRecord } from "../domain/releaseRules";
import type { ReleaseResult } from "../domain/models";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";

describe("workspace reducer boundaries", () => {
  it("rejects a placement that would exceed a site clip limit", () => {
    const state = createSeedStudy();
    const template = state.recordings[1];
    const site = {
      ...state.sites[0],
      id: "site-limit-test",
      name: "Limit test",
      maxClips: 1,
      maxDurationSeconds: 180,
      recordingIds: [],
    };
    const recordings = [
      {
        ...template,
        id: "rec-limit-a",
        catalogId: "LIMIT-A",
        audioSpec: { ...template.audioSpec, durationSeconds: 60 },
      },
      {
        ...template,
        id: "rec-limit-b",
        catalogId: "LIMIT-B",
        audioSpec: { ...template.audioSpec, durationSeconds: 60 },
      },
    ];
    const base = {
      ...state,
      recordings,
      sites: [site],
      issues: [],
      release: null,
    };
    const placed = workspaceReducer(base, {
      type: "placement/assign",
      recordingId: "rec-limit-a",
      siteId: site.id,
    });

    expect(placed.sites[0].recordingIds).toEqual(["rec-limit-a"]);
    expect(() =>
      workspaceReducer(placed, {
        type: "placement/assign",
        recordingId: "rec-limit-b",
        siteId: site.id,
      }),
    ).toThrow(/supports up to 1 clips/);
  });

  it("marks a frozen release stale after a release-relevant change", () => {
    const state = createSeedStudy();
    const readiness: ReleaseResult = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2026-09-10T10:00:00.000Z",
    };
    const release = createReleaseRecord(
      state,
      analyzeRoute(state.recordings, state.sites),
      readiness,
    );
    const frozen = { ...state, release };
    const next = workspaceReducer(frozen, {
      type: "preferences/update",
      preferences: { ...state.preferences, listenerCount: 9 },
    });

    expect(next.release?.status).toBe("stale");
    expect(next.revision).toBe(state.revision + 1);
    expect(next.auditLog.at(-1)).toMatchObject({
      revision: next.revision,
      action: "preferences/update",
    });
  });
});
