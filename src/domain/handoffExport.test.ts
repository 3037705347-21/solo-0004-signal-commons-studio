import { describe, expect, it } from "vitest";
import {
  buildPortableHandoff,
  handoffFileName,
  parsePortableHandoff,
  renderHandoffMarkdown,
  serializePortableHandoff,
} from "./handoffExport";
import { captureBaseline, createHandoffPacket } from "./handoff";
import type { Recording, StudyState } from "./models";
import { createSeedStudy } from "../state/seed";

function pendingStudy(): StudyState {
  const state = createSeedStudy();
  const baseline = captureBaseline(state);
  const newRecording: Recording = {
    ...state.recordings[0],
    id: "rec-portable",
    catalogId: "SC-26-999",
    title: "Portable dawn capture",
    createdAt: "2026-09-13T06:00:00.000Z",
    updatedAt: "2026-09-13T06:00:00.000Z",
  };
  const withClip: StudyState = {
    ...state,
    recordings: [...state.recordings, newRecording],
  };
  const built = createHandoffPacket(
    withClip,
    baseline,
    {
      outgoingName: "Lin Qiao",
      outgoingRole: "Dawn team",
      incomingName: "Amina Patel",
      note: "Fog softened the high end.",
      openItems: [
        {
          id: "item-1",
          title: "Check consent for dawn capture",
          detail: "Speaker near the bridge must confirm.",
          severity: "critical",
          status: "pending",
          createdAt: "2026-09-13T07:00:00.000Z",
        },
      ],
    },
  );
  return {
    ...withClip,
    recordings: built.recordings,
    issues: built.issues,
    handoffs: [built.packet],
  };
}

describe("portable handoff checklist", () => {
  it("builds, serializes, and reparses a versioned portable packet", () => {
    const state = pendingStudy();
    const packet = state.handoffs[0];
    const portable = buildPortableHandoff(state, packet);
    expect(portable.kind).toBe("signal-commons-handoff");
    expect(portable.schemaVersion).toBe(1);
    expect(portable.totals.recordings).toBeGreaterThan(0);
    expect(portable.totals.openItems).toBe(1);

    const raw = serializePortableHandoff(portable);
    const parsed = parsePortableHandoff(raw);
    expect(parsed?.packet.id).toBe(packet.id);
    expect(parsed?.packet.outgoingName).toBe("Lin Qiao");
    expect(parsePortableHandoff("{\"kind\":\"other\"}")).toBeNull();
  });

  it("renders a signable markdown checklist covering scope, changes, and open items", () => {
    const state = pendingStudy();
    const portable = buildPortableHandoff(state, state.handoffs[0]);
    const markdown = renderHandoffMarkdown(portable);
    expect(markdown).toContain("Field handoff #1");
    expect(markdown).toContain("Lin Qiao");
    expect(markdown).toContain("Scope confirmation");
    expect(markdown).toContain("Portable dawn capture");
    expect(markdown).toContain("Check consent for dawn capture");
    expect(markdown).toContain("Receiver sign-off");
  });

  it("uses a dated, sequence-bearing file name", () => {
    const state = pendingStudy();
    expect(handoffFileName(state.handoffs[0], new Date("2026-09-13T10:00:00Z")))
      .toBe("signal-commons-handoff-1-2026-09-13.json");
  });
});
