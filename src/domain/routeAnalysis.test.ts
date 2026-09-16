import { describe, expect, it } from "vitest";
import { analyzeRoute, canPlaceRecording } from "./routeAnalysis";
import { createSeedStudy } from "../state/seed";

const NOW = new Date("2026-09-16T12:00:00.000Z");

describe("route analysis", () => {
  it("reports featured clips that are unplaced", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites.map((site) =>
        site.id === "site-voices" ? { ...site, recordingIds: [] } : site,
      ),
      state.consents,
      NOW,
    );
    expect(analysis.featuredCoverage).toBeLessThan(1);
    expect(analysis.blockingCount).toBeGreaterThan(0);
  });

  it("emits one stable clip-limit finding for repeated overflow", () => {
    const state = createSeedStudy();
    const site = {
      ...state.sites[0],
      maxClips: 1,
      recordingIds: ["rec-market", "rec-tram", "rec-workshop"],
    };
    const analysis = analyzeRoute(
      state.recordings,
      [site],
      state.consents,
      NOW,
    );
    const clipLimitFindings = analysis.findings.filter(
      (finding) => finding.id === `clip-limit-${site.id}`,
    );
    expect(clipLimitFindings).toHaveLength(1);
    expect(clipLimitFindings[0].detail).toContain("3 clips");
  });

  it("blocks sites carrying clips whose consent expired", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      state.consents,
      NOW,
    );
    const expired = analysis.findings.filter(
      (finding) => finding.id === "consent-route-rec-courtyard",
    );
    expect(expired).toHaveLength(1);
    expect(expired[0].type).toBe("error");
  });

  it("warns about unconfirmed consent but notices archive-only gaps", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      state.consents,
      NOW,
    );
    const archiveGaps = analysis.findings.filter((finding) =>
      finding.id.startsWith("consent-archive-"),
    );
    expect(archiveGaps.length).toBeGreaterThan(0);
    expect(archiveGaps.every((finding) => finding.type === "notice")).toBe(true);
  });

  it("prevents placing a withdrawn clip and allows a route-cleared restricted clip", () => {
    const state = createSeedStudy();
    const withdrawn = state.recordings.find(
      (recording) => recording.id === "rec-workshop",
    )!;
    const park = state.recordings.find(
      (recording) => recording.id === "rec-park",
    )!;
    const site = state.sites[0];
    expect(
      canPlaceRecording(withdrawn, site, [], state.consents, NOW).some(
        (finding) =>
          finding.type === "error" &&
          finding.id === "consent-route-rec-workshop",
      ),
    ).toBe(true);
    expect(
      canPlaceRecording(park, site, [], state.consents, NOW).filter(
        (finding) => finding.type === "error",
      ),
    ).toEqual([]);
  });

  it("ignores consent when no ledger is supplied (legacy callers)", () => {
    const state = createSeedStudy();
    const withLegacyCall = analyzeRoute(
      state.recordings,
      [{ ...state.sites[0], recordingIds: ["rec-workshop"] }],
      undefined,
      NOW,
    );
    expect(
      withLegacyCall.findings.some((finding) =>
        finding.id.startsWith("consent-"),
      ),
    ).toBe(false);
  });
});
