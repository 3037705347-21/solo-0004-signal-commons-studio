import { describe, expect, it } from "vitest";
import { emptyRecordingDraft } from "../domain/recordingValidation";
import type { StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import { workspaceReducer } from "./reducer";
import {
  createCommandMeta,
  planAddIssue,
  planAssignRecording,
  planReadinessCheck,
  planRemovePlacement,
  planRemoveRecording,
  planReorderRecording,
  planSnapshotExport,
  planTransitionIssue,
  planUpdatePreferences,
  planUpsertRecording,
  planWorkspaceReset,
  withCommandMeta,
  type CommandPlan,
} from "./commands";
import type { StudyAction } from "./actions";

let commandCounter = 0;

function expectOk<T>(plan: CommandPlan<T>): { action: StudyAction; value?: T } {
  if (!plan.ok)
    throw new Error(`Expected a dispatchable plan, got: ${plan.message}`);
  return plan;
}

/** Commits an action the way the provider does: fresh meta, then the reducer. */
function commit(state: StudyState, action: StudyAction): StudyState {
  commandCounter += 1;
  return workspaceReducer(
    state,
    withCommandMeta(action, {
      commandId: `command-test-${commandCounter}`,
      expectedRevision: state.revision,
      originId: "tab-test",
      issuedAt: "2026-09-16T10:00:00.000Z",
    }),
  );
}

function commitPlan<T>(state: StudyState, plan: CommandPlan<T>): StudyState {
  return commit(state, expectOk(plan).action);
}

describe("recording command plans", () => {
  it("rejects an invalid draft with field-level errors", () => {
    const state = createSeedStudy();
    const plan = planUpsertRecording(state, emptyRecordingDraft);

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.errors).toMatchObject({
      catalogId: "Catalog ID is required.",
      title: "Clip title is required.",
      source: "Recorder or source is required.",
    });
    expect(plan.message).toBe(
      "Review the highlighted fields before saving.",
    );
  });

  it("rejects a duplicate catalogue id", () => {
    const state = createSeedStudy();
    const plan = planUpsertRecording(state, {
      ...emptyRecordingDraft,
      catalogId: "sc-26-001",
      title: "Duplicate catalogue entry",
      source: "Field team",
      recordedOn: "2027-01-04",
      location: "Riverside",
      summary: "A sufficiently long summary of the recorded sound.",
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.errors).toMatchObject({
      catalogId: "Catalog ID must be unique.",
    });
  });

  it("plans a normalized recording upsert that the reducer commits", () => {
    const state = createSeedStudy();
    const plan = planUpsertRecording(state, {
      ...emptyRecordingDraft,
      catalogId: "sc 2027-901",
      title: "Rain Crossing Harmonics",
      source: "Studio North",
      recordedOn: "2027-03-12",
      location: "Maple Street crossing",
      summary:
        "Rain, tires, and a crossing signal create a changing arrival texture.",
    });

    const { action, value } = expectOk(plan);
    expect(action.type).toBe("recording/upsert");
    expect(value?.catalogId).toBe("SC-2027-901");

    const next = commit(state, action);
    expect(next.recordings.map((recording) => recording.catalogId)).toContain(
      "SC-2027-901",
    );
    expect(next.revision).toBe(state.revision + 1);
  });

  it("rejects removing a recording that is already gone", () => {
    const state = createSeedStudy();
    const plan = planRemoveRecording(state, "rec-missing");
    expect(plan).toEqual({
      ok: false,
      message: "The selected clip no longer exists.",
    });
  });

  it("removes a recording along with its placements and linked findings", () => {
    const state = createSeedStudy();
    const plan = planRemoveRecording(state, "rec-courtyard");
    const next = commitPlan(state, plan);

    expect(
      next.recordings.some((recording) => recording.id === "rec-courtyard"),
    ).toBe(false);
    expect(
      next.sites.every(
        (site) => !site.recordingIds.includes("rec-courtyard"),
      ),
    ).toBe(true);
    expect(
      next.issues.some((issue) => issue.recordingId === "rec-courtyard"),
    ).toBe(false);
  });
});

describe("placement command plans", () => {
  function limitedState(): StudyState {
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
    return { ...state, recordings, sites: [site], issues: [], release: null };
  }

  it("rejects a placement that would exceed the site clip limit", () => {
    const base = limitedState();
    const placed = commitPlan(
      base,
      planAssignRecording(base, "rec-limit-a", "site-limit-test"),
    );
    expect(placed.sites[0].recordingIds).toEqual(["rec-limit-a"]);

    const blocked = planAssignRecording(placed, "rec-limit-b", "site-limit-test");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.message).toMatch(/supports up to 1 clips/);
  });

  it("rejects placements into unknown sites or with unknown clips", () => {
    const state = createSeedStudy();
    expect(planAssignRecording(state, "rec-underpass", "site-nope")).toEqual({
      ok: false,
      message: "Cannot place a recording in an unknown site.",
    });
    expect(planAssignRecording(state, "rec-nope", "site-rhythm")).toEqual({
      ok: false,
      message: "Cannot place a clip that is not in the library.",
    });
  });

  it("moves a placed recording between sites", () => {
    const state = createSeedStudy();
    const next = commitPlan(
      state,
      planAssignRecording(state, "rec-drain", "site-return"),
    );
    const site = next.sites.find((candidate) => candidate.id === "site-return");
    expect(site?.recordingIds).toEqual(["rec-bus", "rec-drain"]);
  });

  it("rejects reordering a recording that is not in the site", () => {
    const state = createSeedStudy();
    expect(planReorderRecording(state, "site-rhythm", "rec-bus", 1)).toEqual({
      ok: false,
      message: "The recording is not placed in this site.",
    });
  });

  it("plans no-op reorders at the sequence boundary and for unknown sites", () => {
    const state = createSeedStudy();
    expectOk(planReorderRecording(state, "site-rhythm", "rec-market", -1));
    expectOk(planReorderRecording(state, "site-unknown", "rec-market", 1));
  });

  it("swaps the clip order inside a site", () => {
    const state = createSeedStudy();
    const next = commitPlan(
      state,
      planReorderRecording(state, "site-rhythm", "rec-tram", -1),
    );
    const site = next.sites.find((candidate) => candidate.id === "site-rhythm");
    expect(site?.recordingIds).toEqual(["rec-tram", "rec-market"]);
  });

  it("always plans a placement removal", () => {
    const plan = planRemovePlacement("rec-underpass");
    const next = commitPlan(createSeedStudy(), plan);
    expect(
      next.sites.every((site) => !site.recordingIds.includes("rec-underpass")),
    ).toBe(true);
  });
});

describe("issue command plans", () => {
  const draft = {
    title: "  Confirm release scope  ",
    description: "The listening circle must confirm the release scope.",
    severity: "critical" as const,
    owner: "  Amina Patel  ",
    siteId: "",
    recordingId: "",
  };

  it("validates title, description, and owner", () => {
    expect(planAddIssue({ ...draft, title: " " })).toEqual({
      ok: false,
      errors: { title: "A finding title is required." },
    });
    expect(planAddIssue({ ...draft, description: "too short" })).toEqual({
      ok: false,
      errors: { description: "Add at least 16 characters of context." },
    });
    expect(planAddIssue({ ...draft, owner: "" })).toEqual({
      ok: false,
      errors: { owner: "Assign an owner." },
    });
  });

  it("builds a trimmed open finding with the injected clock and id", () => {
    const at = new Date("2026-09-16T08:30:00.000Z");
    const plan = planAddIssue(draft, at, "issue-test");
    const { action } = expectOk(plan);
    if (action.type !== "issue/add") throw new Error("expected issue/add");
    expect(action.issue).toEqual({
      id: "issue-test",
      title: "Confirm release scope",
      description: "The listening circle must confirm the release scope.",
      severity: "critical",
      status: "open",
      owner: "Amina Patel",
      siteId: undefined,
      recordingId: undefined,
      createdAt: "2026-09-16T08:30:00.000Z",
      updatedAt: "2026-09-16T08:30:00.000Z",
    });
  });

  it("rejects transitions for unknown findings", () => {
    const state = createSeedStudy();
    expect(planTransitionIssue(state, "issue-nope", "resolved")).toEqual({
      ok: false,
      message: "The selected review finding no longer exists.",
    });
  });

  it("rejects illegal status jumps with the transition message", () => {
    const state = createSeedStudy();
    const plan = planTransitionIssue(state, "issue-consent", "resolved");
    expect(plan).toEqual({
      ok: false,
      message: "Cannot move a review finding from open to resolved.",
    });
  });

  it("advances a finding through the allowed states", () => {
    const state = createSeedStudy();
    const started = commitPlan(
      state,
      planTransitionIssue(state, "issue-consent", "in-progress"),
    );
    expect(started.issues[0].status).toBe("in-progress");
    const resolved = commitPlan(
      started,
      planTransitionIssue(started, "issue-consent", "resolved"),
    );
    expect(resolved.issues[0].status).toBe("resolved");
    expect(resolved.issues[0].resolvedAt).toBeTruthy();
  });
});

describe("release command plans", () => {
  it("gates the snapshot export until a current readiness check passes", () => {
    const state = createSeedStudy();
    expect(planSnapshotExport(state)).toEqual({
      ok: false,
      message: "Run a current readiness check before exporting.",
    });
  });

  it("reports the first blocker after a failed readiness check", () => {
    const state = createSeedStudy();
    const { action, result } = planReadinessCheck(state);
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);

    const checked = commit(state, action);
    expect(checked.release?.status).toBe("blocked");
    expect(planSnapshotExport(checked)).toEqual({
      ok: false,
      message: result.blockers[0],
    });
  });

  it("freezes a snapshot after a passing check and stales it on the next change", () => {
    let state = createSeedStudy();
    state = commitPlan(state, planAssignRecording(state, "rec-drain", "site-return"));
    state = commitPlan(state, planTransitionIssue(state, "issue-consent", "in-progress"));
    state = commitPlan(state, planTransitionIssue(state, "issue-consent", "resolved"));

    const revisionBeforeCheck = state.revision;
    const { action, result } = planReadinessCheck(state);
    expect(result.ready).toBe(true);

    const checked = commit(state, action);
    expect(checked.project.stage).toBe("ready");
    expect(checked.release?.status).toBe("ready");
    // A readiness check freezes the current revision instead of bumping it.
    expect(checked.revision).toBe(revisionBeforeCheck);

    const snapshot = planSnapshotExport(checked);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.value?.schemaVersion).toBe(2);
    expect(snapshot.value?.releaseId).toBe(checked.release?.id);
    expect(snapshot.value?.revision).toBe(revisionBeforeCheck);

    const changed = commitPlan(
      checked,
      planUpdatePreferences({ ...checked.preferences, listenerCount: 9 }),
    );
    expect(changed.release?.status).toBe("stale");
    expect(planSnapshotExport(changed)).toEqual({
      ok: false,
      message: "Run a current readiness check before exporting.",
    });
  });

  it("plans a workspace reset back to the seed study", () => {
    let state = createSeedStudy();
    state = commitPlan(state, planAssignRecording(state, "rec-drain", "site-return"));
    expect(state.revision).toBe(1);

    const reset = commitPlan(state, planWorkspaceReset());
    expect(reset.revision).toBe(0);
    expect(reset.recordings.length).toBe(createSeedStudy().recordings.length);
  });
});

describe("command metadata", () => {
  it("attaches idempotency and concurrency identity to actions", () => {
    const at = new Date("2026-09-16T09:15:00.000Z");
    const meta = createCommandMeta(7, "tab-a", at);
    expect(meta).toMatchObject({
      expectedRevision: 7,
      originId: "tab-a",
      issuedAt: "2026-09-16T09:15:00.000Z",
    });
    expect(meta.commandId).toMatch(/^command-/);

    const action = withCommandMeta(
      { type: "placement/remove", recordingId: "rec-bus" },
      meta,
    );
    expect(action.meta).toBe(meta);
  });
});
