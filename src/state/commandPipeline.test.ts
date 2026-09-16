import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { createReleaseRecord } from "../domain/releaseRules";
import type { ReleaseResult, StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import {
  applyMutation,
  applyReleaseRecord,
  AUDIT_LOG_LIMIT,
  commandDisposition,
  finalizeAction,
  invalidateRelease,
  rejectCommand,
} from "./commandPipeline";
import type { StudyAction } from "./actions";

const at = new Date("2026-09-16T12:00:00.000Z");

function meta(
  state: StudyState,
  commandId: string,
  expectedRevision = state.revision,
) {
  return {
    commandId,
    expectedRevision,
    originId: "tab-test",
    issuedAt: "2026-09-16T09:00:00.000Z",
  };
}

function preferencesAction(
  state: StudyState,
  commandId: string,
): Extract<StudyAction, { type: "preferences/update" }> {
  return {
    type: "preferences/update",
    preferences: { ...state.preferences, listenerCount: 8 },
    meta: meta(state, commandId),
  };
}

describe("commandDisposition", () => {
  it("applies commands without meta or with a matching revision", () => {
    const state = createSeedStudy();
    expect(
      commandDisposition(state, {
        type: "preferences/update",
        preferences: state.preferences,
      }),
    ).toBe("apply");
    expect(commandDisposition(state, preferencesAction(state, "c-1"))).toBe(
      "apply",
    );
  });

  it("detects stale revisions as conflicts", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-stale");
    action.meta = { ...action.meta!, expectedRevision: 99 };
    expect(commandDisposition(state, action)).toBe("conflict");
  });

  it("detects repeated command ids as duplicates", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-dup");
    const applied = applyMutation(state, action, {
      ...state,
      preferences: action.preferences!,
    });
    expect(commandDisposition(applied, action)).toBe("duplicate");
  });
});

describe("applyMutation", () => {
  it("commits at the next revision with an applied audit entry", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-apply");
    const next = applyMutation(state, action, {
      ...state,
      preferences: action.preferences!,
    });

    expect(next.revision).toBe(state.revision + 1);
    expect(next.preferences.listenerCount).toBe(8);
    expect(next.auditLog.at(-1)).toMatchObject({
      commandId: "c-apply",
      revision: state.revision + 1,
      status: "applied",
      actor: "local-user",
      action: "preferences/update",
    });
    expect(next.updatedAt).not.toBe(state.updatedAt);
  });

  it("drops a repeated command id without touching state", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-once");
    const applied = applyMutation(state, action, {
      ...state,
      preferences: action.preferences!,
    });
    const duplicate = applyMutation(applied, action, {
      ...applied,
      preferences: { ...applied.preferences, listenerCount: 12 },
    });

    expect(duplicate).toBe(applied);
    expect(
      applied.auditLog.filter((entry) => entry.commandId === "c-once"),
    ).toHaveLength(1);
  });

  it("rejects a stale revision without mutating content", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-stale");
    action.meta = { ...action.meta!, expectedRevision: 99 };
    const rejected = applyMutation(state, action, {
      ...state,
      preferences: action.preferences!,
    });

    expect(rejected.revision).toBe(state.revision);
    expect(rejected.preferences).toBe(state.preferences);
    expect(rejected.recordings).toBe(state.recordings);
    expect(rejected.auditLog).toHaveLength(state.auditLog.length + 1);
    expect(rejected.auditLog.at(-1)).toMatchObject({
      commandId: "c-stale",
      expectedRevision: 99,
      status: "rejected",
      actor: "system",
      revision: state.revision,
    });
  });

  it("marks a frozen release stale when content changes", () => {
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
    const action = preferencesAction(frozen, "c-invalidate");
    const next = applyMutation(frozen, action, {
      ...frozen,
      preferences: action.preferences!,
    });

    expect(next.release?.status).toBe("stale");
    expect(next.release?.id).toBe(release.id);
  });
});

describe("applyReleaseRecord", () => {
  function readinessAction(state: StudyState, commandId: string): StudyAction {
    const readiness: ReleaseResult = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt: "2026-09-16T11:00:00.000Z",
    };
    const release = createReleaseRecord(
      state,
      analyzeRoute(state.recordings, state.sites),
      readiness,
    );
    return { type: "project/readiness", release, meta: meta(state, commandId) };
  }

  it("freezes the release at the current revision without bumping it", () => {
    const state = { ...createSeedStudy(), revision: 3 };
    const action = readinessAction(state, "c-release");
    if (action.type !== "project/readiness") throw new Error("unreachable");
    const committed = applyReleaseRecord(state, action, {
      ...state,
      release: action.release,
    });

    expect(committed.revision).toBe(3);
    expect(committed.release?.status).toBe("ready");
    expect(committed.auditLog.at(-1)).toMatchObject({
      commandId: "c-release",
      revision: 3,
      status: "applied",
    });
  });

  it("drops duplicate readiness commands and rejects stale ones", () => {
    const state = createSeedStudy();
    const action = readinessAction(state, "c-release-dup");
    if (action.type !== "project/readiness") throw new Error("unreachable");
    const committed = applyReleaseRecord(state, action, {
      ...state,
      release: action.release,
    });
    expect(applyReleaseRecord(committed, action, committed)).toBe(committed);

    const stale = readinessAction(state, "c-release-stale");
    stale.meta = { ...stale.meta!, expectedRevision: 42 };
    const rejected = applyReleaseRecord(state, stale, state);
    expect(rejected.release).toBeNull();
    expect(rejected.auditLog.at(-1)).toMatchObject({
      commandId: "c-release-stale",
      status: "rejected",
    });
  });
});

describe("finalizeAction and rejectCommand", () => {
  it("stamps revision, timestamps, and an applied entry", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-final");
    const finalized = finalizeAction(state, action, 5, at);

    expect(finalized.revision).toBe(5);
    expect(finalized.updatedAt).toBe("2026-09-16T12:00:00.000Z");
    expect(finalized.lastSavedAt).toBe("2026-09-16T12:00:00.000Z");
    expect(finalized.auditLog.at(-1)).toMatchObject({
      commandId: "c-final",
      revision: 5,
      status: "applied",
      actor: "local-user",
      timestamp: "2026-09-16T12:00:00.000Z",
    });
  });

  it("records rejections as system entries at the current revision", () => {
    const state = createSeedStudy();
    const action = preferencesAction(state, "c-reject");
    const rejected = rejectCommand(state, action, at);

    expect(rejected.revision).toBe(state.revision);
    expect(rejected.updatedAt).toBe(state.updatedAt);
    expect(rejected.lastSavedAt).toBe("2026-09-16T12:00:00.000Z");
    expect(rejected.auditLog.at(-1)).toMatchObject({
      commandId: "c-reject",
      revision: state.revision,
      status: "rejected",
      actor: "system",
    });
  });

  it("bounds the audit log at the configured limit", () => {
    const state = createSeedStudy();
    const template = state.recordings[0];
    let current = state;
    for (let index = 1; index <= 90; index += 1) {
      const catalogId = `PIPE-${String(index).padStart(3, "0")}`;
      const action: StudyAction = {
        type: "recording/upsert",
        recording: {
          ...template,
          id: `rec-pipe-${index}`,
          catalogId,
        },
        meta: meta(current, `c-pipe-${index}`),
      };
      current = applyMutation(current, action, {
        ...current,
        recordings: [...current.recordings, action.recording!],
      });
    }

    expect(current.revision).toBe(90);
    expect(current.auditLog).toHaveLength(AUDIT_LOG_LIMIT);
    expect(current.auditLog[0].summary).toBe("Saved clip PIPE-011");
    expect(current.auditLog.at(-1)?.summary).toBe("Saved clip PIPE-090");
  });
});

describe("invalidateRelease", () => {
  it("leaves missing or already stale releases untouched", () => {
    const state = createSeedStudy();
    expect(invalidateRelease(state)).toBe(state);

    const stale = {
      ...state,
      release: {
        id: "release-1",
        sequence: 1,
        createdAt: "2026-09-10T10:00:00.000Z",
        status: "stale" as const,
        revision: 0,
        fingerprint: "fp",
        readiness: {
          ready: true,
          score: 100,
          blockers: [],
          cautions: [],
          checkedAt: "2026-09-10T10:00:00.000Z",
        },
      },
    };
    expect(invalidateRelease(stale)).toBe(stale);
  });
});
