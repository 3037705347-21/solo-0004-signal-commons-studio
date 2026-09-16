import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
  liveRecordings,
  liveSites,
} from "../domain/releaseRules";
import type { ReleaseResult, StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";
import { resolveRecording } from "../domain/retentionRegistry";

function readyRelease(state: StudyState, checkedAt: string) {
  const readiness: ReleaseResult = {
    ready: true,
    score: 100,
    blockers: [],
    cautions: [],
    checkedAt,
  };
  return createReleaseRecord(
    state,
    analyzeRoute(liveRecordings(state), liveSites(state)),
    readiness,
  );
}

describe("retention commands in the reducer", () => {
  it("archives an expired unplaced clip as a revision-guarded command", () => {
    const state = createSeedStudy();
    const next = workspaceReducer(state, {
      type: "retention/archive",
      target: "recording",
      id: "rec-belltower",
    });
    expect(next.revision).toBe(state.revision + 1);
    expect(
      next.recordings.find((r) => r.id === "rec-belltower")?.lifecycle?.state,
    ).toBe("archived");
    expect(next.auditLog.at(-1)?.action).toBe("retention/archive");
  });

  it("records a refused archive as a rejected command without changing content", () => {
    const state = createSeedStudy();
    const next = workspaceReducer(state, {
      type: "retention/archive",
      target: "recording",
      id: "rec-underpass", // placed on an active site
    });
    expect(next.revision).toBe(state.revision);
    expect(next.auditLog.at(-1)).toMatchObject({
      action: "retention/archive",
      status: "rejected",
    });
  });

  it("purges an archived clip and keeps its route citation resolvable", () => {
    let state = createSeedStudy();
    state = workspaceReducer(state, {
      type: "retention/archive",
      target: "recording",
      id: "rec-belltower",
    });
    const purged = workspaceReducer(state, {
      type: "retention/purge",
      target: "recording",
      id: "rec-belltower",
    });
    expect(purged.recordings.map((r) => r.id)).not.toContain(
      "rec-belltower",
    );
    expect(
      purged.tombstones.map((t) => t.id),
    ).toContain("rec-belltower");
    expect(resolveRecording(purged, "rec-belltower")?.availability).toBe(
      "purged",
    );
  });

  it("restores an archived clip but forces release re-qualification", () => {
    const state = createSeedStudy();
    const restored = workspaceReducer(state, {
      type: "retention/restore",
      target: "recording",
      id: "rec-ferry-horn",
    });
    const clip = restored.recordings.find((r) => r.id === "rec-ferry-horn");
    expect(clip?.lifecycle?.state).not.toBe("archived");
    expect(clip?.lifecycle?.restoredAt).toBeTruthy();
    // The restored clip must pass a fresh readiness check before release.
    const analysis = analyzeRoute(
      liveRecordings(restored),
      liveSites(restored),
    );
    const blockers = evaluateRelease(restored, analysis).blockers;
    expect(blockers.some((b) => /restored/i.test(b))).toBe(true);
  });

  it("moves a superseded release into lineage while retaining its snapshot citations", () => {
    let state = createSeedStudy();
    const first = readyRelease(state, "2026-09-10T10:00:00.000Z");
    state = { ...state, release: first };
    const secondReady = workspaceReducer(state, {
      type: "project/readiness",
      release: readyRelease(state, "2026-09-11T10:00:00.000Z"),
    });
    expect(secondReady.release?.sequence).toBe(2);
    expect(secondReady.releaseHistory).toHaveLength(2);
    // The prior published version keeps its frozen snapshot and lineage link.
    const prior = secondReady.releaseHistory?.find((r) => r.id === first.id);
    expect(prior?.snapshot).toBeTruthy();
    expect(secondReady.release?.supersedes).toBe(first.id);
    // A clip cleaned from the live library still resolves from the old version.
    expect(
      resolveRecording(secondReady, "rec-rain-basement")?.recording?.title,
    ).toBe("Rain on basement grating");
  });

  it("sweep reports no revision bump when nothing is due", () => {
    const base = createSeedStudy();
    // Only within-retention material is considered here.
    const state: StudyState = {
      ...base,
      recordings: base.recordings.filter(
        (recording) => recording.id === "rec-underpass",
      ),
      sites: base.sites.filter((site) => site.id === "site-threshold"),
      issues: [],
      tombstones: [],
      releaseHistory: [],
    };
    const next = workspaceReducer(state, {
      type: "retention/sweep",
      at: new Date("2026-09-16T00:00:00.000Z"),
    });
    expect(next.revision).toBe(state.revision);
    expect(next.auditLog.map((entry) => entry.action)).not.toContain(
      "retention/sweep",
    );
  });
});
