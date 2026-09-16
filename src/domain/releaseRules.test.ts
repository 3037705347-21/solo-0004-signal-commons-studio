import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import {
  createReleaseRecord,
  evaluateRelease,
} from "./releaseRules";
import type { ConsentGrant, RouteAnalysis } from "./models";
import { createSeedStudy } from "../state/seed";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function withdrawalGrant(recordingId: string): ConsentGrant {
  return {
    id: `grant-withdraw-${recordingId}`,
    recordingId,
    status: "withdrawn",
    purposes: [],
    grantedBy: "Participant",
    channel: "Phone call with witness",
    evidenceRef: "NOTE-WITHDRAW",
    note: "Consent withdrawn.",
    grantedAt: "2026-09-15",
    createdAt: "2026-09-15T10:00:00.000Z",
  };
}

describe("release rules", () => {
  it("blocks release while featured clips or consent findings remain open", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      state.consents,
      NOW,
    );
    const result = evaluateRelease(state, analysis, NOW);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/featured clip/);
    expect(result.blockers.join(" ")).toMatch(/critical consent/);
  });

  it("requires every signal role to be represented in the route", () => {
    const state = createSeedStudy();
    const analysis: RouteAnalysis = {
      totalDurationSeconds: 100,
      placedCount: 3,
      unplacedCount: 0,
      featuredCoverage: 1,
      roleCoverage: 0.75,
      sites: [],
      findings: [],
      blockingCount: 0,
      warningCount: 0,
    };
    const blocker = evaluateRelease(
      { ...state, issues: [] },
      analysis,
      NOW,
    ).blockers.join(" ");
    expect(blocker).toMatch(/arrival, texture, voice, and departure/);
  });

  it("blocks a pending release when placed clips lose usable route consent", () => {
    const state = createSeedStudy();
    const withdrawn = {
      ...state,
      consents: [...state.consents, withdrawalGrant("rec-underpass")],
      issues: [],
    };
    const analysis = analyzeRoute(
      withdrawn.recordings,
      withdrawn.sites,
      withdrawn.consents,
      NOW,
    );
    const result = evaluateRelease(withdrawn, analysis, NOW);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/lack usable route consent/);
  });

  it("warns rather than blocks when route consent exists but archive is withheld", () => {
    const state = createSeedStudy();
    const analysis = analyzeRoute(
      state.recordings,
      state.sites,
      state.consents,
      NOW,
    );
    const result = evaluateRelease(state, analysis, NOW);
    expect(result.cautions.join(" ")).toMatch(/public study archive/);
  });

  it("freezes the consent basis and ledger into a passing snapshot", () => {
    const state = createSeedStudy();
    // Build a minimal passing configuration: every featured clip placed,
    // all roles covered, no issues, full current consent for placed clips.
    const passing: typeof state = {
      ...state,
      issues: [],
      sites: [
        {
          ...state.sites[0],
          maxClips: 4,
          maxDurationSeconds: 2000,
          recordingIds: ["rec-underpass", "rec-tram", "rec-drain"],
        },
        {
          ...state.sites[1],
          maxClips: 4,
          maxDurationSeconds: 2000,
          recordingIds: ["rec-market", "rec-courtyard", "rec-bus"],
        },
      ],
    };
    const renewedCourtyard: ConsentGrant = {
      id: "grant-courtyard-renewed",
      recordingId: "rec-courtyard",
      status: "active",
      purposes: ["route", "transcript", "archive"],
      grantedBy: "North Block listening circle",
      channel: "Group meeting minutes",
      evidenceRef: "MINUTES-2026-014",
      note: "Renewed for the October release.",
      grantedAt: "2026-09-10",
      createdAt: "2026-09-10T09:00:00.000Z",
    };
    passing.consents = [...passing.consents, renewedCourtyard];
    const analysis = analyzeRoute(
      passing.recordings,
      passing.sites,
      passing.consents,
      NOW,
    );
    const readiness = evaluateRelease(passing, analysis, NOW);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    const release = createReleaseRecord(passing, analysis, readiness, NOW);
    const snapshot = release.snapshot;
    expect(snapshot).toBeDefined();
    expect(snapshot?.schemaVersion).toBe(3);
    expect(snapshot?.consents.length).toBe(passing.consents.length);
    const underpassSite = snapshot?.sites.find((site) =>
      site.recordingIds.includes("rec-underpass"),
    );
    const underpass = underpassSite?.recordings.find(
      (recording) => recording.id === "rec-underpass",
    );
    expect(underpass?.consentBasis?.grantId).toBe("grant-underpass");
    expect(underpass?.consentBasis?.purposes).toContain("archive");
  });

  it("keeps the frozen basis of a published release after later withdrawal", () => {
    const state = createSeedStudy();
    const passing: typeof state = {
      ...state,
      issues: [],
      sites: [
        {
          ...state.sites[0],
          maxClips: 4,
          maxDurationSeconds: 2000,
          recordingIds: ["rec-underpass", "rec-tram", "rec-drain"],
        },
        {
          ...state.sites[1],
          maxClips: 4,
          maxDurationSeconds: 2000,
          recordingIds: ["rec-market", "rec-courtyard", "rec-bus"],
        },
      ],
    };
    passing.consents = [
      ...passing.consents,
      {
        id: "grant-courtyard-renewed",
        recordingId: "rec-courtyard",
        status: "active",
        purposes: ["route", "transcript", "archive"],
        grantedBy: "North Block listening circle",
        channel: "Group meeting minutes",
        evidenceRef: "MINUTES-2026-014",
        note: "Renewed for the October release.",
        grantedAt: "2026-09-10",
        createdAt: "2026-09-10T09:00:00.000Z",
      },
    ];
    const readiness = evaluateRelease(
      passing,
      analyzeRoute(passing.recordings, passing.sites, passing.consents, NOW),
      NOW,
    );
    const release = createReleaseRecord(
      passing,
      analyzeRoute(passing.recordings, passing.sites, passing.consents, NOW),
      readiness,
      NOW,
    );
    const snapshotAtRelease = release.snapshot;
    expect(snapshotAtRelease?.consents).toHaveLength(passing.consents.length);

    // Later withdrawal appends a new grant and cannot alter frozen evidence.
    const withdrawn: typeof passing = {
      ...passing,
      consents: [
        ...passing.consents,
        withdrawalGrant("rec-underpass"),
      ],
    };
    const laterAnalysis = analyzeRoute(
      withdrawn.recordings,
      withdrawn.sites,
      withdrawn.consents,
      NOW,
    );
    const laterReadiness = evaluateRelease(withdrawn, laterAnalysis, NOW);
    expect(laterReadiness.ready).toBe(false);
    expect(laterReadiness.blockers.join(" ")).toMatch(
      /lack usable route consent/,
    );

    const frozenUnderpass = snapshotAtRelease?.sites
      .flatMap((site) => site.recordings)
      .find((recording) => recording.id === "rec-underpass");
    expect(frozenUnderpass?.consentBasis?.status).toBe("active");
    expect(frozenUnderpass?.consentBasis?.grantId).toBe("grant-underpass");
    expect(snapshotAtRelease?.consents).toHaveLength(passing.consents.length);
  });
});

