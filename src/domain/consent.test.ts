import { describe, expect, it } from "vitest";
import {
  buildConsentBasis,
  consentBlockReason,
  consentForRecording,
  isConsentUsable,
  isGrantInForce,
  latestGrantFor,
  summarizeConsentImpact,
} from "./consent";
import type { ConsentGrant, Recording, Site } from "./models";

const now = new Date("2026-09-16T12:00:00.000Z");

const recording: Recording = {
  id: "rec-1",
  catalogId: "SC-1",
  title: "Dawn bells",
  source: "Asha",
  recordedOn: "2026-06-01",
  format: "WAV",
  location: "Square",
  summary: "Bells at dawn across the empty square.",
  audioSpec: { sampleRate: 48000, channels: 2, bitDepth: 24, durationSeconds: 30 },
  signalRole: "arrival",
  sensitivity: "public",
  transcriptStatus: "verified",
  consentStatus: "confirmed",
  isFeatured: false,
  tags: [],
  color: "#000",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const fullGrant = (overrides: Partial<ConsentGrant> = {}): ConsentGrant => ({
  id: "grant-1",
  recordingId: "rec-1",
  status: "active",
  purposes: ["route", "transcript", "archive"],
  grantedBy: "Asha",
  channel: "Signed release form",
  evidenceRef: "FORM-1",
  note: "",
  grantedAt: "2026-06-01",
  createdAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

describe("consent ledger resolution", () => {
  it("treats a recording with no grant as pending", () => {
    const decision = consentForRecording("rec-1", [], now);
    expect(decision.status).toBe("pending");
    expect(decision.purposes).toEqual([]);
    expect(isConsentUsable("rec-1", [], "route", now)).toBe(false);
  });

  it("uses the most recently appended grant as the governing decision", () => {
    const original = fullGrant();
    const narrowed = fullGrant({
      id: "grant-2",
      status: "restricted",
      purposes: ["route"],
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const decision = consentForRecording(
      "rec-1",
      [original, narrowed],
      now,
    );
    expect(decision.grant?.id).toBe("grant-2");
    expect(decision.status).toBe("restricted");
    expect(decision.purposes).toEqual(["route"]);
    expect(isConsentUsable("rec-1", [original, narrowed], "route", now)).toBe(
      true,
    );
    expect(isConsentUsable("rec-1", [original, narrowed], "archive", now)).toBe(
      false,
    );
  });

  it("blocks all purposes once consent is withdrawn", () => {
    const grants = [
      fullGrant(),
      fullGrant({
        id: "grant-3",
        status: "withdrawn",
        purposes: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        note: "Participant withdrew.",
      }),
    ];
    const decision = consentForRecording("rec-1", grants, now);
    expect(decision.status).toBe("withdrawn");
    expect(decision.purposes).toEqual([]);
    expect(
      consentBlockReason(recording, grants, "route", now),
    ).toMatch(/withdrawn/);
  });

  it("expires grants after their expiry date", () => {
    const grant = fullGrant({ expiresAt: "2026-08-31" });
    expect(isGrantInForce(grant, now)).toBe(false);
    const decision = consentForRecording("rec-1", [grant], now);
    expect(decision.status).toBe("expired");
    expect(decision.purposes).toEqual([]);
    expect(
      consentBlockReason(recording, [grant], "route", now),
    ).toMatch(/expired/);
  });

  it("keeps a grant in force up to and including its expiry day", () => {
    const grant = fullGrant({ expiresAt: "2026-09-16" });
    expect(isGrantInForce(grant, now)).toBe(true);
  });

  it("freezes the grant into a consent basis for release snapshots", () => {
    const grant = fullGrant({ expiresAt: "2027-01-01" });
    const basis = buildConsentBasis("rec-1", [grant], now);
    expect(basis).toMatchObject({
      grantId: "grant-1",
      purposes: ["route", "transcript", "archive"],
      grantedBy: "Asha",
      evidenceRef: "FORM-1",
    });
    expect(basis?.resolvedAt).toBe(now.toISOString());
  });

  it("summarizes impact against placements", () => {
    const site: Site = {
      id: "site-1",
      name: "Threshold",
      shortLabel: "Threshold",
      prompt: "prompt",
      maxDurationSeconds: 300,
      maxClips: 2,
      quietSpace: true,
      hasSeating: true,
      color: "#000",
      sequence: 0,
      recordingIds: ["rec-1"],
    };
    const grants = [
      fullGrant({ status: "restricted", purposes: ["route"] }),
    ];
    const [impact] = summarizeConsentImpact(
      [recording],
      grants,
      [site],
      now,
    );
    expect(impact.placed).toBe(true);
    expect(impact.siteIds).toEqual(["site-1"]);
    expect(impact.blocksRoute).toBe(false);
    expect(impact.archiveGap).toBe(true);
  });

  it("flags placements with no usable route consent", () => {
    const site: Site = {
      id: "site-1",
      name: "Threshold",
      shortLabel: "Threshold",
      prompt: "prompt",
      maxDurationSeconds: 300,
      maxClips: 2,
      quietSpace: true,
      hasSeating: true,
      color: "#000",
      sequence: 0,
      recordingIds: ["rec-1"],
    };
    const grants = [
      fullGrant({ status: "withdrawn", purposes: [] }),
    ];
    const [impact] = summarizeConsentImpact(
      [recording],
      grants,
      [site],
      now,
    );
    expect(impact.blocksRoute).toBe(true);
    expect(impact.archiveGap).toBe(false);
  });

  it("returns no basis when no grant exists", () => {
    expect(buildConsentBasis("rec-1", [], now)).toBeNull();
    expect(latestGrantFor("missing", [fullGrant()])).toBeUndefined();
  });
});
