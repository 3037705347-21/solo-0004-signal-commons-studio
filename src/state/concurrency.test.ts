import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { createReleaseRecord, evaluateRelease } from "../domain/releaseRules";
import { releaseFingerprint } from "../domain/releaseIdentity";
import {
  selectRecordingsForSite,
  selectRecordingSite,
} from "../state/selectors";
import type { CommandMeta, StudyAction } from "../state/actions";
import { workspaceReducer } from "./reducer";
import { createSeedStudy } from "./seed";
import { createReadyStudy } from "./testSupport";
import type { QualityIssue, StudyState } from "../domain/models";

function meta(
  commandId: string,
  expectedRevision: number,
  origin = "tab-a",
  issuedAt = "2026-09-10T10:00:00.000Z",
): CommandMeta {
  return { commandId, expectedRevision, originId: origin, issuedAt };
}

function preferenceCommand(
  state: StudyState,
  listenerCount: number,
  commandId: string,
  origin = "tab-a",
): StudyAction {
  return {
    type: "preferences/update",
    preferences: { ...state.preferences, listenerCount },
    meta: meta(commandId, state.revision, origin),
  };
}

function addFindingCommand(index: number): (state: StudyState) => StudyAction {
  const now = "2026-09-10T12:00:00.000Z";
  const issue: QualityIssue = {
    id: `issue-filler-${index}`,
    title: `Distinct filler finding ${index} for the bounded audit log`,
    description: `Enough context for filler finding number ${index} to pass any shape check.`,
    severity: "note",
    status: "open",
    owner: "Audit Log Probe",
    createdAt: now,
    updatedAt: now,
  };
  return (state) => ({
    type: "issue/add",
    issue,
    meta: meta(`filler-${index}`, state.revision, "tab-a", now),
  });
}

describe("concurrent commits", () => {
  it("accepts one of two simultaneous commits and records the stale one as rejected without changing content", () => {
    const baseline = createSeedStudy();
    const fromA = preferenceCommand(baseline, 11, "cmd-concurrent-a", "tab-a");
    const fromB = preferenceCommand(baseline, 22, "cmd-concurrent-b", "tab-b");

    const afterA = workspaceReducer(baseline, fromA);
    const afterB = workspaceReducer(afterA, fromB);

    expect(afterA.revision).toBe(baseline.revision + 1);
    expect(afterA.preferences.listenerCount).toBe(11);
    // B was built against the same base revision: it must be a conflict, not a
    // silently accepted overwrite, and A's fact must remain visible.
    expect(afterB.revision).toBe(afterA.revision);
    expect(afterB.preferences.listenerCount).toBe(11);
    expect(afterB.auditLog.at(-1)).toMatchObject({
      commandId: "cmd-concurrent-b",
      status: "rejected",
      expectedRevision: baseline.revision,
      revision: afterA.revision,
    });
  });

  it("keeps winning and rebased commits consistent across derived views", () => {
    const baseline = createSeedStudy();
    const afterA = workspaceReducer(
      baseline,
      preferenceCommand(baseline, 11, "cmd-concurrent-a", "tab-a"),
    );
    const reconciled = workspaceReducer(
      afterA,
      preferenceCommand(afterA, 22, "cmd-concurrent-b-rebased", "tab-b"),
    );

    expect(reconciled.preferences.listenerCount).toBe(22);
    expect(reconciled.revision).toBe(baseline.revision + 2);
    const analysis = analyzeRoute(reconciled.recordings, reconciled.sites);
    expect(analysis.placedCount + analysis.unplacedCount).toBe(
      reconciled.recordings.length,
    );
    reconciled.sites.forEach((site) => {
      const view = selectRecordingsForSite(reconciled, site.id);
      expect(view.map((clip) => clip.id)).toEqual(site.recordingIds);
      site.recordingIds.forEach((id) => {
        expect(selectRecordingSite(reconciled, id)?.id).toBe(site.id);
      });
    });
  });

  it("does not let storage synchronization replace equal-revision divergent commits from another tab", () => {
    // Reproduces the exact decision in StudyContext's storage event handler:
    // equal revisions are ignored only when updatedAt also matches; equal
    // revisions with different timestamps wholesale replace local state,
    // although the reducer rejects that same pair as a stale commit.
    const baseline = createSeedStudy();
    const committedInA = workspaceReducer(
      baseline,
      preferenceCommand(baseline, 11, "cmd-tab-a", "tab-a"),
    );
    const committedInB = workspaceReducer(
      baseline,
      preferenceCommand(baseline, 22, "cmd-tab-b", "tab-b"),
    );
    // Real tabs dispatch at different instants; the storage handler relies on
    // updatedAt as a tiebreaker, so model distinct commit timestamps.
    committedInB.updatedAt = new Date(
      Date.parse(committedInA.updatedAt) + 5,
    ).toISOString();
    expect(committedInA.revision).toBe(committedInB.revision);
    expect(committedInA.updatedAt).not.toBe(committedInB.updatedAt);

    const incoming = committedInB;
    const current = committedInA;
    const shouldReplace =
      !(
        incoming.revision < current.revision ||
        (incoming.revision === current.revision &&
          incoming.updatedAt === current.updatedAt)
      );

    // A divergence the reducer rejects must not enter through the sync path.
    expect(shouldReplace).toBe(false);
    if (shouldReplace) {
      // The loss would be silent: the replaced commit has no rejection record
      // in the incoming audit log, and its fact is gone.
      const lossRecorded = incoming.auditLog.some(
        (entry) => entry.commandId === "cmd-tab-a" &&
          entry.status === "rejected",
      );
      expect(lossRecorded).toBe(true);
    }
  });
});

describe("duplicate operations", () => {
  it("applies a replayed command id only once even after the audit log compacts past its bound", () => {
    let state = createSeedStudy();
    const target = preferenceCommand(state, 7, "cmd-replay-target", "tab-a");
    state = workspaceReducer(state, target);
    const revisionAfterTarget = state.revision;

    // The compact log is bounded at 80 entries. Apply >80 distinct legal
    // commands so the target entry leaves the window, then replay it.
    for (let index = 0; index < 82; index += 1) {
      state = workspaceReducer(state, addFindingCommand(index)(state));
    }
    expect(
      state.auditLog.some((entry) => entry.commandId === "cmd-replay-target"),
    ).toBe(false);
    expect(state.auditLog.length).toBeLessThanOrEqual(80);

    const replayed = workspaceReducer(state, target);
    // Idempotency must follow command identity, not whatever slice of history
    // happens to remain; otherwise the replay bumps revision and changes data.
    expect(replayed.revision).toBe(revisionAfterTarget);
    expect(replayed.preferences.listenerCount).toBe(7);
  });

  it("keeps repeated distinct commands of the same action type distinguishable in the bounded audit log", () => {
    const state0 = createSeedStudy();
    const ids: string[] = [];
    let state = state0;
    for (let index = 0; index < 5; index += 1) {
      const id = `cmd-repeat-${index}`;
      ids.push(id);
      state = workspaceReducer(state, preferenceCommand(state, index, id));
    }

    // All five are distinct commands even though they share action type and
    // summary shape; the log must distinguish them by command id.
    expect(
      ids.filter((id) =>
        state.auditLog.some((entry) => entry.commandId === id),
      ),
    ).toEqual(ids);
    expect(state.preferences.listenerCount).toBe(4);
    expect(state.revision).toBe(state0.revision + 5);
  });

  it("accepts a rebased retry after a stale attempt of the same edit", () => {
    const baseline = createSeedStudy();
    const stale: StudyAction = {
      type: "preferences/update",
      preferences: { ...baseline.preferences, listenerCount: 9 },
      meta: meta("cmd-retry", baseline.revision + 50, "tab-a"),
    };
    const rejected = workspaceReducer(baseline, stale);
    expect(rejected.auditLog.at(-1)).toMatchObject({
      commandId: "cmd-retry",
      status: "rejected",
    });

    const moved = workspaceReducer(
      rejected,
      preferenceCommand(rejected, 3, "cmd-other", "tab-b"),
    );
    const retry = workspaceReducer(
      moved,
      preferenceCommand(moved, 9, "cmd-retry-rebased", "tab-a"),
    );
    expect(retry.preferences.listenerCount).toBe(9);
    expect(retry.revision).toBe(moved.revision + 1);
  });
});

describe("release supersession under concurrency", () => {
  function readyRelease(state: StudyState, checkedAt: string) {
    const analysis = analyzeRoute(state.recordings, state.sites);
    const readiness: ReturnType<typeof evaluateRelease> = {
      ready: true,
      score: 100,
      blockers: [],
      cautions: [],
      checkedAt,
    };
    return createReleaseRecord(state, analysis, readiness);
  }

  function readinessAction(
    state: StudyState,
    checkedAt: string,
    commandId: string,
    origin: string,
  ): StudyAction {
    return {
      type: "project/readiness",
      release: readyRelease(state, checkedAt),
      meta: meta(commandId, state.revision, origin, checkedAt),
    };
  }

  it("freezes a release at a content revision and bumps the committed revision so peers detect it", () => {
    const baseline = createReadyStudy();
    const frozen = workspaceReducer(
      baseline,
      readinessAction(baseline, "2026-09-10T10:00:00.000Z", "rel-1", "tab-a"),
    );

    expect(frozen.release?.status).toBe("ready");
    expect(frozen.release?.revision).toBe(baseline.revision);
    expect(frozen.release?.fingerprint).toBe(releaseFingerprint(baseline));
    // Every commit advances the monotonic content revision; without a bump two
    // tabs cannot distinguish "frozen" from "not yet checked".
    expect(frozen.revision).toBe(baseline.revision + 1);
  });

  it("rejects a second tab's readiness commit built against the same pre-release revision instead of forking lineage", () => {
    const baseline = createReadyStudy();
    const tabA = workspaceReducer(
      baseline,
      readinessAction(baseline, "2026-09-10T10:00:00.000Z", "rel-a", "tab-a"),
    );
    const merged = workspaceReducer(
      tabA,
      readinessAction(baseline, "2026-09-10T10:01:00.000Z", "rel-b", "tab-b"),
    );

    // Both releases claim the same sequence over the same predecessor;
    // accepting both forks the lineage into two current releases.
    expect(merged.release?.id).toBe(tabA.release?.id);
    expect(merged.auditLog.at(-1)).toMatchObject({
      commandId: "rel-b",
      status: "rejected",
    });
    expect(merged.release?.supersedes).toBeUndefined();
  });

  it("chains a later rebased release through the applied predecessor", () => {
    const baseline = createReadyStudy();
    const first = workspaceReducer(
      baseline,
      readinessAction(baseline, "2026-09-10T10:00:00.000Z", "rel-1", "tab-a"),
    );
    const changed = workspaceReducer(first, {
      type: "preferences/update",
      preferences: { ...first.preferences, accessPriority: 82 },
      meta: meta("change-2", first.revision, "tab-b"),
    });
    const second = workspaceReducer(
      changed,
      readinessAction(changed, "2026-09-11T10:00:00.000Z", "rel-2", "tab-b"),
    );

    expect(second.release?.status).toBe("ready");
    expect(second.release?.sequence).toBe(2);
    expect(second.release?.supersedes).toBe(first.release?.id);
    expect(second.release?.revision).toBe(changed.revision);
    expect(first.release?.snapshot?.fingerprint).toBe(
      releaseFingerprint(baseline),
    );
    expect(second.release?.snapshot?.preferences.accessPriority).toBe(82);
  });

  it("records a blocked readiness check without dropping the prior ready release from the lineage chain", () => {
    const baseline = createReadyStudy();
    const first = workspaceReducer(
      baseline,
      readinessAction(baseline, "2026-09-10T10:00:00.000Z", "rel-ready", "tab-a"),
    );
    // A release-relevant change happens (adds an unresolved critical finding)
    // and the check now fails.
    const stamped = "2026-09-10T11:00:00.000Z";
    const blockedState = workspaceReducer(first, {
      type: "issue/add",
      issue: {
        id: "issue-new-blocker",
        title: "Newly discovered consent blocker",
        description: "A participant withdrew consent after the freeze completed.",
        severity: "critical",
        status: "open",
        owner: "Review desk",
        createdAt: stamped,
        updatedAt: stamped,
      },
      meta: meta("change-blocker", first.revision, "tab-a", stamped),
    });
    const blockedAnalysis = analyzeRoute(
      blockedState.recordings,
      blockedState.sites,
    );
    const blockedResult = evaluateRelease(
      blockedState,
      blockedAnalysis,
      new Date("2026-09-10T12:00:00.000Z"),
    );
    expect(blockedResult.ready).toBe(false);
    const blocked = workspaceReducer(blockedState, {
      type: "project/readiness",
      release: createReleaseRecord(
        blockedState,
        blockedAnalysis,
        blockedResult,
      ),
      meta: meta("rel-blocked", blockedState.revision, "tab-a"),
    });

    expect(blocked.release?.status).toBe("blocked");
    expect(blocked.release?.sequence).toBe(2);
    expect(blocked.release?.supersedes).toBe(first.release?.id);
    expect(blocked.release?.snapshot).toBeUndefined();
    // The frozen release content remains available via the lineage even though
    // export is now blocked: its snapshot must not be mutated away.
    expect(first.release?.snapshot?.releaseId).toBe(first.release?.id);
  });
});

describe("reset under concurrency", () => {
  it("does not let a stale reset silently wipe commits made in another tab", () => {
    const baseline = createSeedStudy();
    const edited = workspaceReducer(
      baseline,
      preferenceCommand(baseline, 11, "cmd-edit-a", "tab-a"),
    );
    // Tab B rendered before A's commit and now triggers a reset, still carrying
    // the old expected revision.
    const reset: StudyAction = {
      type: "workspace/reset",
      state: createSeedStudy(),
      meta: meta("cmd-reset-b", baseline.revision, "tab-b"),
    };
    const afterReset = workspaceReducer(edited, reset);

    expect(afterReset.revision).toBe(edited.revision);
    expect(afterReset.preferences.listenerCount).toBe(11);
    expect(afterReset.auditLog.at(-1)).toMatchObject({
      commandId: "cmd-reset-b",
      status: "rejected",
    });
  });
});
