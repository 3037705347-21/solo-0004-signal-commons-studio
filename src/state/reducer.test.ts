import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { createReleaseRecord } from "../domain/releaseRules";
import type {
  ConflictRecord,
  ReleaseResult,
  StudyState,
} from "../domain/models";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";

function conflictFrom(
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
): ConflictRecord {
  return {
    id: "conflict-reducer",
    detectedAt: "2026-09-12T10:00:00.000Z",
    originId: "tab-a",
    originLabel: "This tab",
    commandSummary: "Saved clip SC-26-001",
    baseRevision: base.revision,
    oursRevision: ours.revision,
    theirsRevision: theirs.revision,
    base,
    ours,
    theirs,
  };
}

const resolveMeta = {
  commandId: "command-resolve",
  expectedRevision: 0,
  originId: "tab-a",
  issuedAt: "2026-09-12T10:05:00.000Z",
};

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

  it("applies a command id only once", () => {
    const state = createSeedStudy();
    const command = {
      type: "preferences/update" as const,
      preferences: { ...state.preferences, listenerCount: 8 },
      meta: {
        commandId: "command-once",
        expectedRevision: state.revision,
        originId: "tab-a",
        issuedAt: "2026-09-10T10:00:00.000Z",
      },
    };
    const applied = workspaceReducer(state, command);
    const duplicate = workspaceReducer(applied, command);

    expect(applied.revision).toBe(1);
    expect(duplicate.revision).toBe(applied.revision);
    expect(
      applied.auditLog.filter((entry) => entry.commandId === "command-once"),
    ).toHaveLength(1);
  });

  it("rejects a command based on a stale revision without mutating content", () => {
    const state = createSeedStudy();
    const rejected = workspaceReducer(state, {
      type: "preferences/update",
      preferences: { ...state.preferences, listenerCount: 8 },
      meta: {
        commandId: "command-stale",
        expectedRevision: 99,
        originId: "tab-b",
        issuedAt: "2026-09-10T10:00:00.000Z",
      },
    });

    expect(rejected).toMatchObject({
      revision: state.revision,
      preferences: state.preferences,
    });
    expect(rejected.auditLog.at(-1)).toMatchObject({
      commandId: "command-stale",
      expectedRevision: 99,
      status: "rejected",
    });
  });

  it("links each frozen release to its predecessor", () => {
    const state = createSeedStudy();
    const readiness: ReleaseResult = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2026-09-10T10:00:00.000Z",
    };
    const analysis = analyzeRoute(state.recordings, state.sites);
    const first = createReleaseRecord(state, analysis, readiness);
    const second = createReleaseRecord(
      { ...state, release: first },
      analysis,
      { ...readiness, checkedAt: "2026-09-11T10:00:00.000Z" },
    );

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second.supersedes).toBe(first.id);
    expect(second.snapshot?.releaseId).toBe(second.id);
    expect(second.snapshot?.releaseSequence).toBe(2);
  });

  it("resolves a conflict by keeping the committed version and appending an audit trail", () => {
    const base = createSeedStudy();
    const ours = {
      ...base,
      revision: 1,
      updatedAt: "2026-09-12T09:00:00.000Z",
      preferences: { ...base.preferences, listenerCount: 9 },
    };
    const theirs = {
      ...base,
      revision: 2,
      updatedAt: "2026-09-12T09:05:00.000Z",
      preferences: { ...base.preferences, listenerCount: 14 },
    };
    const resolved = workspaceReducer(theirs, {
      type: "conflict/resolve",
      conflict: conflictFrom(base, ours, theirs),
      mode: "theirs",
      meta: resolveMeta,
    });

    expect(resolved.revision).toBe(3);
    expect(resolved.preferences.listenerCount).toBe(14);
    expect(resolved.auditLog.at(-1)).toMatchObject({
      action: "conflict/resolve",
      revision: 3,
      status: "applied",
      conflictId: "conflict-reducer",
    });
  });

  it("replays a conflict resolution command id only once", () => {
    const base = createSeedStudy();
    const theirs = {
      ...base,
      revision: 2,
      updatedAt: "2026-09-12T09:05:00.000Z",
    };
    const action = {
      type: "conflict/resolve" as const,
      conflict: conflictFrom(base, base, theirs),
      mode: "theirs" as const,
      meta: resolveMeta,
    };
    const once = workspaceReducer(theirs, action);
    const twice = workspaceReducer(once, action);
    expect(twice.revision).toBe(once.revision);
    expect(
      once.auditLog.filter((entry) => entry.commandId === "command-resolve"),
    ).toHaveLength(1);
  });

  it("merges both sides when resolving with merge choices", () => {
    const base = createSeedStudy();
    const ours = {
      ...base,
      revision: 1,
      updatedAt: "2026-09-12T09:00:00.000Z",
      recordings: base.recordings.map((recording) =>
        recording.id === "rec-underpass"
          ? { ...recording, title: "Our underpass title" }
          : recording,
      ),
    };
    const theirs = {
      ...base,
      revision: 2,
      updatedAt: "2026-09-12T09:05:00.000Z",
      preferences: { ...base.preferences, listenerCount: 15 },
    };
    const resolved = workspaceReducer(theirs, {
      type: "conflict/resolve",
      conflict: conflictFrom(base, ours, theirs),
      mode: "merge",
      mergeChoices: { "recordings:rec-underpass": "ours" },
      meta: { ...resolveMeta, commandId: "command-merge" },
    });

    expect(
      resolved.recordings.find((recording) => recording.id === "rec-underpass")
        ?.title,
    ).toBe("Our underpass title");
    expect(resolved.preferences.listenerCount).toBe(15);
    expect(resolved.revision).toBe(3);
  });
});
