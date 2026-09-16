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

  it("holds a proposed rule adjustment aside without changing evaluation", () => {
    const state = createSeedStudy();
    const before = state.activeRuleVersionId;
    const proposed = workspaceReducer(state, {
      type: "rules/propose",
      label: "Tighter pilot rules",
      note: "Tighten capacity for the winter pilot listening sessions.",
      rules: {
        ...state.ruleVersions[0].rules,
        capacityWarnAt: 0.5,
        sensitivePolicy: "block-placement",
      },
    });

    expect(proposed.pendingRuleChange).not.toBeNull();
    expect(proposed.activeRuleVersionId).toBe(before);
    // Proposals are audited revisions but do not invalidate the release.
    expect(proposed.release).toBeNull();
    expect(proposed.revision).toBe(1);
    expect(proposed.auditLog.at(-1)?.action).toBe("rules/propose");
  });

  it("adopts a confirmed draft as a new active immutable version", () => {
    const state = createSeedStudy();
    const rules = {
      ...state.ruleVersions[0].rules,
      capacityWarnAt: 0.5,
    };
    const drafted = workspaceReducer(state, {
      type: "rules/propose",
      label: "Winter thresholds",
      note: "Lower headroom warning because sites fill quickly in winter.",
      rules,
    });
    const adopted = workspaceReducer(drafted, {
      type: "rules/adopt",
      change: drafted.pendingRuleChange!,
    });

    expect(adopted.pendingRuleChange).toBeNull();
    expect(adopted.ruleVersions).toHaveLength(2);
    const active = adopted.ruleVersions.find(
      (version) => version.id === adopted.activeRuleVersionId,
    );
    expect(active?.label).toBe("Winter thresholds");
    expect(active?.rules.capacityWarnAt).toBeCloseTo(0.5);
    expect(active?.adoptedAt).toBeTruthy();
    expect(adopted.auditLog.at(-1)?.action).toBe("rules/adopt");
  });

  it("marks a frozen release stale when rules are adopted", () => {
    const seed = createSeedStudy();
    // Build a study that actually passes under the baseline rules.
    const state: typeof seed = {
      ...seed,
      project: { ...seed.project, stage: "ready" },
      issues: seed.issues.map((issue) => ({ ...issue, status: "resolved" as const })),
      sites: seed.sites.map((site) =>
        site.id === "site-voices"
          ? {
              ...site,
              maxClips: 3,
              maxDurationSeconds: 1200,
              recordingIds: ["rec-courtyard", "rec-drain", "rec-park"],
            }
          : site,
      ),
    };
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
    expect(release.status).toBe("ready");
    const frozen = { ...state, release };

    const adopted = workspaceReducer(frozen, {
      type: "rules/adopt",
      change: {
        label: "New gate",
        note: "Change the release gate for a stricter study cycle.",
        rules: {
          ...state.ruleVersions[0].rules,
          capacityWarnAt: 0.5,
        },
        createdAt: "2026-09-12T10:00:00.000Z",
      },
    });

    expect(adopted.release?.status).toBe("stale");
    // The published snapshot itself remains frozen under the old basis.
    expect(adopted.release?.snapshot?.ruleVersion.id).toBe(
      release.snapshot?.ruleVersion.id,
    );
  });

  it("discards a draft without changing the active rule version", () => {
    const state = createSeedStudy();
    const activeBefore = state.activeRuleVersionId;
    const drafted = workspaceReducer(state, {
      type: "rules/propose",
      label: "Abandoned idea",
      note: "An experiment we decide not to run this season.",
      rules: { ...state.ruleVersions[0].rules, capacityWarnAt: 0.4 },
    });
    const discarded = workspaceReducer(drafted, { type: "rules/discard" });

    expect(discarded.pendingRuleChange).toBeNull();
    expect(discarded.activeRuleVersionId).toBe(activeBefore);
    expect(discarded.ruleVersions).toHaveLength(1);
    expect(discarded.auditLog.at(-1)?.action).toBe("rules/discard");
  });
});
