import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { evaluateRelease } from "./releaseRules";
import type { Recording, StudyState } from "./models";
import {
  captureBaseline,
  createHandoffPacket,
  decideHandoff,
  deriveChanges,
  guardWorkspaceMutation,
  pendingHandoff,
  releaseHandoffBlockers,
  rollbackDeclinedHandoff,
  withdrawHandoff,
} from "./handoff";
import { createSeedStudy } from "../state/seed";
import { workspaceReducer } from "../state/reducer";

function seedWithRecording(): { state: StudyState; recording: Recording } {
  const state = createSeedStudy();
  const template = state.recordings[0];
  const recording: Recording = {
    ...template,
    id: "rec-handoff-new",
    catalogId: "SC-26-900",
    title: "Off-grid night chorus",
    createdAt: "2026-09-12T20:00:00.000Z",
    updatedAt: "2026-09-12T20:00:00.000Z",
    isFeatured: false,
  };
  return { state, recording };
}

describe("handoff baseline and change derivation", () => {
  it("captures the inherited baseline before the session", () => {
    const state = createSeedStudy();
    const baseline = captureBaseline(state);
    expect(baseline.revision).toBe(0);
    expect(baseline.recordingIds).toHaveLength(state.recordings.length);
    expect(baseline.siteSequences["site-threshold"]).toEqual([
      "rec-underpass",
    ]);
  });

  it("derives added clips, placements, and findings against the baseline", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const next: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
      sites: state.sites.map((site) =>
        site.id === "site-return"
          ? { ...site, recordingIds: [...site.recordingIds, recording.id] }
          : site,
      ),
      issues: [
        {
          id: "issue-new",
          title: "Wind distortion on night chorus",
          description: "Check the limiter before this clip is used.",
          severity: "warning",
          status: "open",
          recordingId: recording.id,
          owner: "Lin Qiao",
          createdAt: "2026-09-12T21:00:00.000Z",
          updatedAt: "2026-09-12T21:00:00.000Z",
        },
        ...state.issues,
      ],
    };
    const changes = deriveChanges(next, baseline);
    expect(changes.some((c) => c.kind === "recording-added")).toBe(true);
    expect(changes.some((c) => c.kind === "placement-added")).toBe(true);
    expect(changes.some((c) => c.kind === "issue-added")).toBe(true);
  });

  it("keeps removals visible even though the entity is gone", () => {
    const state = createSeedStudy();
    const baseline = captureBaseline(state);
    const next: StudyState = {
      ...state,
      recordings: state.recordings.filter((r) => r.id !== "rec-bus"),
      sites: state.sites.map((site) => ({
        ...site,
        recordingIds: site.recordingIds.filter((id) => id !== "rec-bus"),
      })),
    };
    const changes = deriveChanges(next, baseline);
    expect(changes.some((c) => c.kind === "recording-removed")).toBe(true);
    expect(changes.some((c) => c.kind === "placement-removed")).toBe(true);
  });
});

describe("handoff packet lifecycle", () => {
  it("tags newly introduced clips and findings with the packet id for provenance", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin Qiao",
        outgoingRole: "Night capture",
        incomingName: "Amina Patel",
        note: "Battery was low.",
        openItems: [],
      },
    );
    expect(packet.status).toBe("pending");
    expect(packet.sequence).toBe(1);
    expect(recordings.find((r) => r.id === recording.id)?.handoffId).toBe(
      packet.id,
    );
    expect(issues.find((r) => r.handoffId === packet.id)).toBeUndefined();
  });

  it("blocks release judgment while a packet is pending", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin Qiao",
        outgoingRole: "",
        incomingName: "Amina Patel",
        note: "",
        openItems: [
          {
            id: "item-1",
            title: "Re-record at dawn",
            detail: "Wind clipped the take.",
            severity: "critical",
            status: "pending",
            createdAt: "2026-09-12T22:00:00.000Z",
          },
        ],
      },
    );
    const pending: StudyState = {
      ...withClip,
      recordings,
      issues,
      handoffs: [packet],
    };
    const blockers = releaseHandoffBlockers(pending);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0]).toMatch(/waiting for receiver confirmation/);
    expect(blockers.some((b) => b.includes("critical handover item"))).toBe(
      true,
    );
    const result = evaluateRelease(
      pending,
      analyzeRoute(pending.recordings, pending.sites),
    );
    expect(result.ready).toBe(false);
  });

  it("freezes every content change until the receiver decides, including renames and late additions", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    const pending: StudyState = {
      ...withClip,
      recordings,
      issues,
      handoffs: [packet],
    };
    expect(pendingHandoff(pending)?.id).toBe(packet.id);
    expect(guardWorkspaceMutation(pending).blocked).toBe(true);

    // A session-introduced clip cannot be removed.
    expect(() =>
      workspaceReducer(pending, {
        type: "recording/remove",
        recordingId: recording.id,
      }),
    ).toThrow(/with the receiver/);

    // An inherited (baseline) clip cannot be renamed either — this is the
    // divergence that previously let a new title bypass the checklist.
    const baselineClip = pending.recordings[0];
    expect(() =>
      workspaceReducer(pending, {
        type: "recording/upsert",
        recording: { ...baselineClip, title: "Renamed after packet" },
      }),
    ).toThrow(/with the receiver/);

    // A brand new clip cannot be added after the packet was prepared, so it
    // can never silently land in release judgment without being listed.
    const lateClip: Recording = {
      ...recording,
      id: "rec-late",
      catalogId: "SC-26-901",
    };
    expect(() =>
      workspaceReducer(pending, {
        type: "recording/upsert",
        recording: lateClip,
      }),
    ).toThrow(/with the receiver/);

    // Placements, findings, and preferences are locked as well.
    expect(() =>
      workspaceReducer(pending, {
        type: "placement/assign",
        recordingId: "rec-bus",
        siteId: "site-rhythm",
      }),
    ).toThrow(/with the receiver/);
    expect(() =>
      workspaceReducer(pending, {
        type: "preferences/update",
        preferences: { ...pending.preferences, listenerCount: 12 },
      }),
    ).toThrow(/with the receiver/);
  });

  it("withdrawing a packet reopens the session, strips provenance, and re-enables edits", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    const pending: StudyState = {
      ...withClip,
      recordings,
      issues,
      handoffs: [packet],
    };
    const reopened = withdrawHandoff(pending, packet);
    expect(reopened.handoffs[0].status).toBe("withdrawn");
    expect(reopened.activeBaseline?.revision).toBe(baseline.revision);
    expect(
      reopened.recordings.find((r) => r.id === recording.id)?.handoffId,
    ).toBeUndefined();
    expect(guardWorkspaceMutation(reopened).blocked).toBe(false);

    // Editing resumes, and a fresh packet can be prepared from the session.
    const edited = workspaceReducer(reopened, {
      type: "recording/upsert",
      recording: { ...recording, title: "Night chorus, second pass" },
    });
    expect(edited.recordings.find((r) => r.id === recording.id)?.title).toBe(
      "Night chorus, second pass",
    );
    const reprepared = createHandoffPacket(
      edited,
      reopened.activeBaseline as NonNullable<typeof reopened.activeBaseline>,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    expect(reprepared.packet.sequence).toBe(2);
    expect(reprepared.packet.status).toBe("pending");
    expect(
      reprepared.recordings.find((r) => r.id === recording.id)?.handoffId,
    ).toBe(reprepared.packet.id);
  });

  it("acceptance releases the scope into normal release judgment", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    const pending: StudyState = {
      ...withClip,
      recordings,
      issues,
      handoffs: [packet],
    };
    const acceptedPacket = decideHandoff(
      packet,
      "accepted",
      "Amina Patel",
      "Scope looks right.",
    );
    const accepted: StudyState = {
      ...pending,
      handoffs: [acceptedPacket],
    };
    expect(pendingHandoff(accepted)).toBeUndefined();
    expect(releaseHandoffBlockers(accepted)).toEqual([]);
    expect(guardWorkspaceMutation(accepted).blocked).toBe(false);
    expect(acceptedPacket.receiverName).toBe("Amina Patel");
  });

  it("declining rolls back clips introduced only by the session but keeps baseline clips", () => {
    const { state, recording } = seedWithRecording();
    const baseline = captureBaseline(state);
    const withClip: StudyState = {
      ...state,
      recordings: [...state.recordings, recording],
      sites: state.sites.map((site) =>
        site.id === "site-return"
          ? { ...site, recordingIds: [...site.recordingIds, recording.id] }
          : site,
      ),
    };
    const { packet, recordings, issues } = createHandoffPacket(
      withClip,
      baseline,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    const pending: StudyState = {
      ...withClip,
      recordings,
      issues,
      handoffs: [packet],
    };
    const declined = decideHandoff(packet, "declined", "Amina", "Not ours.");
    const rolledBack = rollbackDeclinedHandoff(
      { ...pending, handoffs: [declined] },
      declined,
    );
    expect(rolledBack.recordings.some((r) => r.id === recording.id)).toBe(
      false,
    );
    expect(rolledBack.recordings).toHaveLength(state.recordings.length);
    expect(
      rolledBack.sites
        .find((s) => s.id === "site-return")
        ?.recordingIds.includes(recording.id),
    ).toBe(false);
  });

  it("sequences packets and links each accepted packet to its predecessor", () => {
    const state = createSeedStudy();
    const first = createHandoffPacket(
      state,
      captureBaseline(state),
      {
        outgoingName: "A",
        outgoingRole: "",
        incomingName: "B",
        note: "",
        openItems: [],
      },
    ).packet;
    const acceptedFirst = decideHandoff(first, "accepted", "B", "");
    const next: StudyState = { ...state, handoffs: [acceptedFirst] };
    const second = createHandoffPacket(
      next,
      captureBaseline(next),
      {
        outgoingName: "B",
        outgoingRole: "",
        incomingName: "C",
        note: "",
        openItems: [],
      },
    ).packet;
    expect(second.sequence).toBe(2);
    expect(second.supersedes).toBe(first.id);
  });
});

describe("handoff reducer commands", () => {
  it("creates a pending packet, accepts it through a command, and bumps revisions", () => {
    let state = createSeedStudy();
    const baseline = captureBaseline(state);
    state = workspaceReducer(state, {
      type: "handoff/begin",
      baseline,
    });
    expect(state.activeBaseline?.revision).toBe(0);
    const { recording } = seedWithRecording();
    state = { ...state, recordings: [...state.recordings, recording] };
    const built = createHandoffPacket(
      state,
      baseline,
      {
        outgoingName: "Lin",
        outgoingRole: "",
        incomingName: "Amina",
        note: "",
        openItems: [],
      },
    );
    state = workspaceReducer(state, {
      type: "handoff/create",
      packet: built.packet,
      recordings: built.recordings,
      issues: built.issues,
    });
    expect(state.handoffs[0].status).toBe("pending");
    expect(state.activeBaseline).toBeNull();
    const decided = workspaceReducer(state, {
      type: "handoff/decide",
      handoffId: built.packet.id,
      decision: "accepted",
      receiverName: "Amina",
      receiverNote: "",
    });
    expect(decided.handoffs[0].status).toBe("accepted");
    expect(decided.recordings.some((r) => r.id === recording.id)).toBe(true);
    expect(decided.revision).toBeGreaterThan(0);
  });

  it("refuses to start a second concurrent handoff session", () => {
    const state = createSeedStudy();
    const baseline = captureBaseline(state);
    const first = workspaceReducer(state, {
      type: "handoff/begin",
      baseline,
    });
    expect(() =>
      workspaceReducer(first, {
        type: "handoff/begin",
        baseline: captureBaseline(first),
      }),
    ).toThrow(/offline session is already open/);
  });
});
