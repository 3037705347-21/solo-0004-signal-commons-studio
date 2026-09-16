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

  it("appends a withdrawal, denormalizes the headline, and invalidates the release", () => {
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
      analyzeRoute(state.recordings, state.sites, state.consents),
      readiness,
    );
    const frozen = {
      ...state,
      release: { ...release, status: "ready" as const },
      project: { ...state.project, stage: "ready" as const },
    };
    const next = workspaceReducer(frozen, {
      type: "consent/withdraw",
      grant: {
        id: "grant-test-withdraw",
        recordingId: "rec-underpass",
        status: "withdrawn",
        purposes: [],
        grantedBy: "Lin Qiao",
        channel: "Phone call",
        evidenceRef: "NOTE-1",
        note: "Changed mind.",
        grantedAt: "2026-09-15",
        createdAt: "2026-09-15T10:00:00.000Z",
      },
    });
    expect(next.consents.at(-1)?.id).toBe("grant-test-withdraw");
    expect(
      next.recordings.find((recording) => recording.id === "rec-underpass")
        ?.consentStatus,
    ).toBe("withdrawn");
    expect(next.release?.status).toBe("stale");
    expect(next.project.stage).not.toBe("ready");
    // The frozen snapshot still carries the original release basis.
    expect(
      release.snapshot?.sites.some((site) =>
        site.recordings.some(
          (recording) =>
            recording.id === "rec-underpass" &&
            recording.consentBasis?.grantId === "grant-underpass",
        ),
      ),
    ).toBe(true);
  });

  it("rejects placing a clip whose consent was withdrawn", () => {
    const state = createSeedStudy();
    const withdrawn = workspaceReducer(state, {
      type: "consent/withdraw",
      grant: {
        id: "grant-test-withdraw-workshop",
        recordingId: "rec-workshop",
        status: "withdrawn",
        purposes: [],
        grantedBy: "Jae Min",
        channel: "Email",
        evidenceRef: "NOTE-2",
        note: "Remove from route.",
        grantedAt: "2026-09-15",
        createdAt: "2026-09-15T10:00:00.000Z",
      },
    });
    expect(() =>
      workspaceReducer(withdrawn, {
        type: "placement/assign",
        recordingId: "rec-workshop",
        siteId: "site-threshold",
      }),
    ).toThrow(/cannot be used/);
  });
});
