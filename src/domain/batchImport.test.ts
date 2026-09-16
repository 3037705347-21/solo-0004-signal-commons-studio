import { describe, expect, it } from "vitest";
import { createSeedStudy } from "../state/seed";
import type { StudyState } from "./models";
import {
  batchKey,
  commitBatch,
  parseBatchText,
  reviewBatch,
  type BatchSession,
} from "./batchImport";

const recordingRow = (overrides: Record<string, unknown> = {}) => ({
  catalogId: "SC-26-201",
  title: "Lantern workshop hush",
  source: "Lin Qiao",
  recordedOn: "2026-09-01",
  format: "WAV",
  location: "Lantern Lane",
  summary:
    "A quiet workshop moment with brushes, paper, and a distant evening call to prayer.",
  sampleRate: 48000,
  channels: 2,
  bitDepth: 24,
  durationSeconds: 120,
  signalRole: "arrival",
  sensitivity: "public",
  transcriptStatus: "draft",
  consentStatus: "pending",
  ...overrides,
});

function sessionFrom(rows: Record<string, unknown>[]): BatchSession {
  const parsed = parseBatchText(JSON.stringify({ batchId: "b1", rows: [], recordings: rows }));
  if (!parsed.session) throw new Error(parsed.errors.join("; "));
  return parsed.session;
}

describe("parseBatchText", () => {
  it("rejects malformed JSON", () => {
    const result = parseBatchText("{not json");
    expect(result.session).toBeNull();
    expect(result.errors[0]).toMatch(/not valid JSON/);
  });

  it("treats a batch without any rows as a blocking file error", () => {
    const result = parseBatchText(JSON.stringify({ batchId: "empty" }));
    expect(result.session).not.toBeNull();
    expect(result.session?.rows).toHaveLength(0);
    expect(result.session?.fileErrors[0].message).toMatch(/no recordings/);
  });

  it("keeps readable rows while carrying a corrupted record as a file error", () => {
    const result = parseBatchText(
      JSON.stringify({
        batchId: "partial",
        recordings: [recordingRow({ catalogId: "SC-26-220" }), null],
      }),
    );
    expect(result.session?.rows).toHaveLength(1);
    expect(result.session?.fileErrors).toEqual([
      expect.objectContaining({ ref: "recordings[2]" }),
    ]);
    // The readable record alone passes row validation, but the file blocks it.
    const review = reviewBatch(result.session!, createSeedStudy());
    expect(review.invalidCount).toBe(0);
    expect(review.fileErrors).toHaveLength(1);
    expect(() => commitBatch(result.session!, createSeedStudy())).toThrow(
      /unreadable section/,
    );
  });

  it("flags non-array sections and structured scalar values as file errors", () => {
    const sectionResult = parseBatchText(
      JSON.stringify({ recordings: "not-a-list" }),
    );
    expect(sectionResult.session?.fileErrors[0]).toMatchObject({
      ref: "recordings",
    });

    const nested = parseBatchText(
      JSON.stringify({
        recordings: [
          recordingRow({ catalogId: "SC-26-221", title: ["a", "b"] }),
        ],
      }),
    );
    expect(nested.session?.rows).toHaveLength(0);
    expect(nested.session?.fileErrors[0].message).toMatch(/“title”/);
    expect(() => commitBatch(nested.session!, createSeedStudy())).toThrow();
  });

  it("coerces numeric and scalar fields into editable row drafts", () => {
    const { session } = parseBatchText(
      JSON.stringify({ recordings: [recordingRow()] }),
    );
    expect(session?.rows).toHaveLength(1);
    expect(session?.rows[0]).toMatchObject({ kind: "recording" });
  });

  it("splits standalone placements and issues into typed rows", () => {
    const { session } = parseBatchText(
      JSON.stringify({
        batchId: "mixed",
        placements: [{ catalogId: "SC-26-003", site: "Rhythms" }],
        issues: [
          {
            title: "Check release",
            description: "Need sixteen characters of context here please.",
            severity: "critical",
            owner: "Amina Patel",
            catalogId: "SC-26-003",
          },
        ],
      }),
    );
    expect(session?.rows.map((row) => row.kind)).toEqual([
      "placement",
      "issue",
    ]);
  });
});

describe("reviewBatch", () => {
  it("flags a recording row that breaks existing business rules", () => {
    const state = createSeedStudy();
    const session = sessionFrom([
      recordingRow({ summary: "too short", catalogId: "SC-26-210" }),
    ]);
    const review = reviewBatch(session, state);
    expect(review.invalidCount).toBe(1);
    expect(review.rows[0].errors.some((e) => /20 characters/.test(e.message))).toBe(true);
    expect(review.validCount).toBe(0);
  });

  it("flags duplicate catalog ids against the library and within the batch", () => {
    const state = createSeedStudy();
    const within = sessionFrom([
      recordingRow({ catalogId: "SC-26-301" }),
      recordingRow({ catalogId: "SC-26-301", title: "Different title" }),
    ]);
    const duplicatePair = reviewBatch(within, state);
    expect(duplicatePair.rows[1].errors.some((e) => /more than once/.test(e.message))).toBe(true);

    const againstLibrary = sessionFrom([recordingRow({ catalogId: "SC-26-001" })]);
    const review = reviewBatch(againstLibrary, state);
    expect(review.rows[0].duplicateOf).toBe("recording");
  });

  it("enforces site clip and duration limits for batch placements", () => {
    const state: StudyState = {
      ...createSeedStudy(),
      sites: [
        {
          ...createSeedStudy().sites[0],
          id: "site-tight",
          name: "Tight corner",
          shortLabel: "Tight",
          maxClips: 1,
          maxDurationSeconds: 300,
          recordingIds: ["rec-underpass"],
        },
      ],
    };
    const session = sessionFrom([
      recordingRow({ catalogId: "SC-26-401", durationSeconds: 120, site: "Tight" }),
    ]);
    const review = reviewBatch(session, state);
    expect(review.rows[0].errors.some((e) => /supports up to 1 clips/.test(e.message))).toBe(true);
  });

  it("marks an existing route position as a duplicate instead of an error", () => {
    const state = createSeedStudy();
    const { session: placementSession } = parseBatchText(
      JSON.stringify({
        placements: [{ catalogId: "SC-26-001", site: "Threshold listening" }],
      }),
    );
    const review = reviewBatch(placementSession as BatchSession, state);
    expect(review.rows[0].duplicateOf).toBe("placement");
  });

  it("resolves a placement against a recording introduced earlier in the same batch", () => {
    const state = createSeedStudy();
    const { session } = parseBatchText(
      JSON.stringify({
        recordings: [recordingRow({ catalogId: "SC-26-501" })],
        placements: [{ catalogId: "SC-26-501", site: "Return" }],
      }),
    );
    const review = reviewBatch(session as BatchSession, state);
    expect(review.invalidCount).toBe(0);
    expect(review.rows[1].duplicateOf).toBeUndefined();
  });

  it("requires findings to meet the description and owner rules", () => {
    const state = createSeedStudy();
    const { session } = parseBatchText(
      JSON.stringify({
        issues: [
          { title: "Short", description: "brief", severity: "warning", owner: "" },
        ],
      }),
    );
    const review = reviewBatch(session as BatchSession, state);
    expect(review.invalidCount).toBe(1);
    expect(review.rows[0].errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(["description", "owner"]),
    );
  });
});

describe("commitBatch atomicity and identity", () => {
  it("applies recordings, placements, and issues in one resolved result", () => {
    const state = createSeedStudy();
    const { session } = parseBatchText(
      JSON.stringify({
        batchId: "sweep-a",
        label: "September sweep",
        recordings: [
          recordingRow({
            catalogId: "SC-26-601",
            title: "Harbor gull descent",
            signalRole: "departure",
          }),
        ],
        placements: [{ catalogId: "SC-26-601", site: "Return" }],
        issues: [
          {
            title: "Harbor gull consent check",
            description: "Confirm the fisherman's voice can stay in the public pack.",
            severity: "critical",
            owner: "Rosa Mendes",
            catalogId: "SC-26-601",
          },
        ],
      }),
    );
    const result = commitBatch(session as BatchSession, state);
    expect(result.counts).toEqual({
      recordings: 1,
      placements: 1,
      issues: 1,
      skipped: 0,
    });
    const returnSite = result.sites.find((site) => site.id === "site-return");
    expect(returnSite?.recordingIds).toContain(
      result.recordings.find((r) => r.catalogId === "SC-26-601")!.id,
    );
    expect(result.issues.at(-1)?.recordingId).toBe(
      result.recordings.find((r) => r.catalogId === "SC-26-601")!.id,
    );
  });

  it("throws when any row is invalid, leaving caller collections untouched", () => {
    const state = createSeedStudy();
    const session = sessionFrom([
      recordingRow({ catalogId: "SC-26-701" }),
      recordingRow({ catalogId: "SC-26-702", summary: "bad" }),
    ]);
    expect(() => commitBatch(session, state)).toThrow();
    // Caller's state object is never mutated by a failed commit.
    expect(state.recordings.some((r) => r.catalogId === "SC-26-701")).toBe(false);
  });

  it("produces a stable key for identical batches and distinct keys for different content", () => {
    const contentSession = (rows: Record<string, unknown>[]) =>
      parseBatchText(JSON.stringify({ recordings: rows })).session as BatchSession;
    const a = contentSession([recordingRow({ catalogId: "SC-26-801" })]);
    const b = contentSession([recordingRow({ catalogId: "SC-26-801" })]);
    const c = contentSession([recordingRow({ catalogId: "SC-26-802" })]);
    expect(batchKey(a)).toBe(batchKey(b));
    expect(batchKey(a)).not.toBe(batchKey(c));
  });

  it("skips rows that already exist instead of duplicating them", () => {
    const state = createSeedStudy();
    const { session } = parseBatchText(
      JSON.stringify({
        batchId: "sweep-dup",
        recordings: [
          recordingRow({ catalogId: "SC-26-001", site: "Threshold listening" }),
        ],
      }),
    );
    const result = commitBatch(session as BatchSession, state);
    expect(result.counts.recordings).toBe(0);
    expect(result.counts.placements).toBe(0);
    expect(result.counts.skipped).toBe(1);
    expect(result.recordings.filter((r) => r.catalogId === "SC-26-001")).toHaveLength(1);
  });

  it("derives deterministic ids for repeated submissions of the same batch", () => {
    const state = createSeedStudy();
    const make = () =>
      parseBatchText(
        JSON.stringify({
          batchId: "sweep-idem",
          recordings: [recordingRow({ catalogId: "SC-26-901" })],
        }),
      ).session as BatchSession;
    const first = commitBatch(make(), state);
    const appliedState: StudyState = {
      ...state,
      recordings: first.recordings,
      sites: first.sites,
      issues: first.issues,
    };
    const second = commitBatch(make(), appliedState);
    expect(second.counts.skipped).toBe(1);
    expect(second.recordings.filter((r) => r.catalogId === "SC-26-901")).toHaveLength(1);
  });

  it("refuses a second route position for an already placed clip", () => {
    const state = createSeedStudy();
    const { session } = parseBatchText(
      JSON.stringify({
        placements: [{ catalogId: "SC-26-001", site: "Return" }],
      }),
    );
    expect(() => commitBatch(session as BatchSession, state)).toThrow(/already placed/);
  });
});
