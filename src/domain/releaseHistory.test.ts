import { describe, expect, it } from "vitest";
import { analyzeRoute } from "./routeAnalysis";
import { createReleaseRecord } from "./releaseRules";
import type { ReleaseResult, StudyState } from "./models";
import {
  canForkDraft,
  captureReleaseContent,
  describeReleaseStatus,
  diffReleases,
} from "./releaseHistory";
import { createSeedStudy } from "../state/seed";

const passingResult: ReleaseResult = {
  ready: true,
  score: 100,
  blockers: [],
  cautions: [],
  checkedAt: "2026-09-10T10:00:00.000Z",
};

function readyState(seed: StudyState): StudyState {
  // Resolve all issues, place featured clips and cover every signal role.
  const issues = seed.issues.map((issue) => ({
    ...issue,
    status: "resolved" as const,
    resolvedAt: "2026-09-10T09:00:00.000Z",
  }));
  const sites = seed.sites.map((site) => ({ ...site }));
  // Featured: underpass(placed), market(placed), courtyard(placed), drain(unplaced)
  const drainSite = sites.find((site) => site.id === "site-return")!;
  const drainSiteIds = [...drainSite.recordingIds, "rec-drain"];
  // Roles present: arrival, texture, voice (courtyard), departure (bus). Drain is voice too.
  return {
    ...seed,
    issues,
    sites: sites.map((site) =>
      site.id === "site-return"
        ? { ...site, recordingIds: drainSiteIds }
        : site,
    ),
  };
}

describe("release history lineage", () => {
  it("freezes content at check time so later edits do not rewrite history", () => {
    const seed = createSeedStudy();
    const record = createReleaseRecord(
      seed,
      analyzeRoute(seed.recordings, seed.sites),
      passingResult,
    );
    expect(canForkDraft(record)).toBe(true);
    expect(() => {
      // @ts-expect-error history records are frozen at runtime
      record.content.recordings[0].title = "rewritten";
    }).toThrow();
  });

  it("classifies a ready entry as current, stale, then superseded", () => {
    const seed = readyState(createSeedStudy());
    const first = createReleaseRecord(
      seed,
      analyzeRoute(seed.recordings, seed.sites),
      passingResult,
    );
    expect(describeReleaseStatus(first, [first], first.fingerprint).status).toBe(
      "current",
    );
    const changed = {
      ...seed,
      preferences: { ...seed.preferences, listenerCount: 12 },
    };
    expect(describeReleaseStatus(first, [first], "different-fp").status).toBe(
      "stale",
    );
    const second = createReleaseRecord(
      { ...changed, release: first, releaseHistory: [first] },
      analyzeRoute(changed.recordings, changed.sites),
      { ...passingResult, checkedAt: "2026-09-11T10:00:00.000Z" },
    );
    const view = describeReleaseStatus(first, [first, second], second.fingerprint);
    expect(view.status).toBe("superseded");
    expect(view.label).toMatch(/v2/);
    expect(second.supersedes).toBe(first.id);
  });

  it("keeps a blocked check visible but publishable-ready status reflects the gate", () => {
    const seed = createSeedStudy();
    const blockedResult: ReleaseResult = {
      ready: false,
      score: 28,
      blockers: ["Critical findings remain unresolved."],
      cautions: [],
      checkedAt: "2026-09-10T10:00:00.000Z",
    };
    const blocked = createReleaseRecord(
      seed,
      analyzeRoute(seed.recordings, seed.sites),
      blockedResult,
    );
    expect(blocked.status).toBe("blocked");
    expect(blocked.snapshot).toBeUndefined();
    expect(canForkDraft(blocked)).toBe(true);
    expect(describeReleaseStatus(blocked, [blocked], "whatever").status).toBe(
      "blocked",
    );
  });

  it("diffs recordings, sites, and findings between two versions", () => {
    const seed = createSeedStudy();
    const first = createReleaseRecord(
      seed,
      analyzeRoute(seed.recordings, seed.sites),
      passingResult,
    );
    const next: StudyState = {
      ...seed,
      release: first,
      releaseHistory: [first],
      recordings: seed.recordings.map((recording) =>
        recording.id === "rec-market"
          ? { ...recording, transcriptStatus: "verified" }
          : recording,
      ),
      sites: seed.sites.map((site) =>
        site.id === "site-voices"
          ? { ...site, recordingIds: [...site.recordingIds, "rec-drain"] }
          : site,
      ),
      issues: seed.issues.map((issue) =>
        issue.id === "issue-consent"
          ? { ...issue, status: "in-progress", updatedAt: "2026-09-11T09:00:00.000Z" }
          : issue,
      ),
    };
    const second = createReleaseRecord(
      next,
      analyzeRoute(next.recordings, next.sites),
      { ...passingResult, checkedAt: "2026-09-11T10:00:00.000Z" },
    );
    const diff = diffReleases(first, second)!;
    const recording = diff.recordings.find(
      (change) => change.recordingId === "rec-market",
    );
    expect(recording?.fields.some((field) => field.field === "Transcript")).toBe(
      true,
    );
    const voices = diff.sites.find((change) => change.siteId === "site-voices");
    expect(voices?.clipsAdded.map((clip) => clip.id)).toContain("rec-drain");
    const consent = diff.issues.find(
      (change) => change.issueId === "issue-consent",
    );
    expect(consent?.fields.some((field) => field.field === "Status")).toBe(true);
  });

  it("captures added and removed recordings as placement changes", () => {
    const seed = createSeedStudy();
    const content = captureReleaseContent(seed, "2026-09-10T10:00:00.000Z");
    expect(content.recordings).toHaveLength(seed.recordings.length);
    const without = {
      ...content,
      recordings: content.recordings.filter(
        (recording) => recording.id !== "rec-bus",
      ),
    };
    const first = createReleaseRecord(
      seed,
      analyzeRoute(seed.recordings, seed.sites),
      passingResult,
    );
    const laterState: StudyState = {
      ...seed,
      recordings: without.recordings,
      sites: seed.sites.map((site) => ({
        ...site,
        recordingIds: site.recordingIds.filter((id) => id !== "rec-bus"),
      })),
      release: first,
      releaseHistory: [first],
    };
    const second = createReleaseRecord(
      laterState,
      analyzeRoute(laterState.recordings, laterState.sites),
      { ...passingResult, checkedAt: "2026-09-12T10:00:00.000Z" },
    );
    const diff = diffReleases(first, second)!;
    const removed = diff.recordings.find(
      (change) => change.recordingId === "rec-bus",
    );
    expect(removed?.kind).toBe("removed");
    expect(removed?.placementTo).toMatch(/Removed/);
  });
});
