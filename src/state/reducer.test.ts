import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { createReleaseRecord } from "../domain/releaseRules";
import {
  batchKey,
  commitBatch,
  parseBatchText,
  reviewBatch,
} from "../domain/batchImport";
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
});

describe("batch import command", () => {
  const validRecording = {
    catalogId: "SC-26-777",
    title: "Lantern workshop hush",
    source: "Lin Qiao",
    recordedOn: "2026-09-01",
    format: "WAV",
    location: "Lantern Lane",
    summary:
      "Brushes, paper, and a distant evening call settle into a quiet room.",
    sampleRate: 48000,
    channels: 2,
    bitDepth: 24,
    durationSeconds: 120,
    signalRole: "arrival",
    sensitivity: "public",
    transcriptStatus: "draft",
    consentStatus: "pending",
  };

  const batchAction = (state: ReturnType<typeof createSeedStudy>) => {
    const parsed = parseBatchText(
      JSON.stringify({ batchId: "sweep-reducer", recordings: [validRecording] }),
    );
    const session = parsed.session!;
    const review = reviewBatch(session, state);
    expect(review.invalidCount).toBe(0);
    return { session, commit: commitBatch(session, state) };
  };

  it("records the batch in a single revision and leaves a receipt", () => {
    const state = createSeedStudy();
    const payload = batchAction(state);
    const next = workspaceReducer(state, {
      type: "batch/import",
      ...payload,
      meta: {
        commandId: "batch-command-1",
        expectedRevision: state.revision,
        originId: "tab-a",
        issuedAt: "2026-09-12T10:00:00.000Z",
      },
    });

    expect(next.revision).toBe(state.revision + 1);
    expect(next.recordings).toHaveLength(state.recordings.length + 1);
    expect(next.imports).toHaveLength(1);
    expect(next.imports[0]).toMatchObject({
      recordingCount: 1,
      batchKey: batchKey(payload.session),
    });
    expect(next.auditLog.at(-1)).toMatchObject({ action: "batch/import" });
  });

  it("replays the same batch command without duplicating recordings", () => {
    const state = createSeedStudy();
    const payload = batchAction(state);
    const meta = {
      commandId: "batch-command-same",
      expectedRevision: state.revision,
      originId: "tab-a",
      issuedAt: "2026-09-12T10:00:00.000Z",
    } as const;
    const first = workspaceReducer(state, { type: "batch/import", ...payload, meta });
    const replay = workspaceReducer(first, { type: "batch/import", ...payload, meta });

    expect(replay).toBe(first);
    expect(
      replay.recordings.filter((recording) => recording.catalogId === "SC-26-777"),
    ).toHaveLength(1);
    expect(replay.imports).toHaveLength(1);
  });

  it("throws rather than leaving a half-applied batch when a row is invalid", () => {
    const state = createSeedStudy();
    const parsed = parseBatchText(
      JSON.stringify({
        batchId: "sweep-invalid",
        recordings: [
          validRecording,
          { ...validRecording, catalogId: "SC-26-778", summary: "bad" },
        ],
      }),
    );
    const session = parsed.session!;
    expect(() =>
      workspaceReducer(state, {
        type: "batch/import",
        session,
        // Deliberately bypassing commitBatch to prove the reducer re-validates.
        commit: {
          key: batchKey(session),
          label: "x",
          recordings: [...state.recordings],
          sites: state.sites,
          issues: state.issues,
          counts: { recordings: 2, placements: 0, issues: 0, skipped: 0 },
          catalogIds: ["SC-26-777", "SC-26-778"],
        },
      }),
    ).toThrow();
    expect(state.recordings).toHaveLength(createSeedStudy().recordings.length);
  });
});
