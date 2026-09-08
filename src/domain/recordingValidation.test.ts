import { describe, expect, it } from "vitest";
import {
  emptyRecordingDraft,
  recordingFromDraft,
  validateRecordingDraft,
} from "./recordingValidation";
describe("recording validation", () => {
  it("rejects duplicate catalog ids and weak summaries", () => {
    const existing = recordingFromDraft({
      ...emptyRecordingDraft,
      catalogId: "SC-1",
      title: "Existing",
      source: "Recorder",
      summary: "A sufficiently descriptive field recording summary.",
    });
    const errors = validateRecordingDraft(
      {
        ...emptyRecordingDraft,
        catalogId: "sc-1",
        title: "New",
        source: "Recorder",
        summary: "Too short",
      },
      [existing],
    );
    expect(errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(["catalogId", "summary"]),
    );
  });
  it("creates a recording with audio metadata", () => {
    const recording = recordingFromDraft({
      ...emptyRecordingDraft,
      catalogId: "SC-2026-001",
      title: "Rain",
      source: "Field team",
      summary: "A sufficiently descriptive summary of the recording.",
    });
    expect(recording.audioSpec.sampleRate).toBe(48000);
    expect(recording.audioSpec.durationSeconds).toBe(120);
  });
});
