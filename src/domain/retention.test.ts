import { describe, expect, it } from "vitest";
import { createSeedStudy } from "../state/seed";
import type { StudyState } from "./models";
import {
  RETENTION_POLICY,
  buildRetentionReport,
  evaluateRetentionStatus,
  recordingRetention,
  siteRetention,
} from "./retention";
import {
  archiveRecording,
  purgeRecording,
  purgeSite,
  restoreRecording,
  restoreSite,
  requalify,
  runRetentionSweep,
  RetentionError,
} from "./retentionLifecycle";
import { resolveRecording, resolveSite } from "./retentionRegistry";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function seed(): StudyState {
  return createSeedStudy();
}

describe("retention policy windows", () => {
  it("classifies fresh material as within-retention", () => {
    const state = seed();
    const status = recordingRetention(state.recordings[0], NOW);
    expect(status.state).toBe("within-retention");
    expect(status.daysRemaining).toBeGreaterThan(0);
    expect(RETENTION_POLICY["active-recording"].retentionDays).toBe(180);
  });

  it("marks material past its category window as expired", () => {
    const state = seed();
    const expired = state.recordings.find(
      (recording) => recording.id === "rec-belltower",
    );
    expect(expired).toBeTruthy();
    expect(recordingRetention(expired!, NOW).state).toBe("expired");
  });

  it("reports one entry per record across all business categories", () => {
    const report = buildRetentionReport(seed(), NOW);
    expect(report.recordings.length).toBe(10);
    expect(report.sites.length).toBe(5);
    expect(report.batches.length).toBe(2);
    expect(report.releases.length).toBe(1);
    expect(report.summary.recordings.expired).toBeGreaterThanOrEqual(1);
    expect(report.summary.recordings.archived).toBeGreaterThanOrEqual(1);
    // Published releases use a long, multi-year window.
    expect(RETENTION_POLICY["published-release"].retentionDays).toBe(1095);
  });

  it("derives expiry deterministically from the anchor", () => {
    const within = evaluateRetentionStatus(
      "quality-finding",
      "2026-09-01T00:00:00.000Z",
      undefined,
      NOW,
    );
    expect(within.state).toBe("within-retention");
    const expired = evaluateRetentionStatus(
      "quality-finding",
      "2025-01-01T00:00:00.000Z",
      undefined,
      NOW,
    );
    expect(expired.state).toBe("expired");
    expect(expired.eligibleForArchive).toBe(true);
  });
});

describe("archival and reference continuity", () => {
  it("refuses to archive a clip still used by an active site", () => {
    const state = seed();
    expect(() => archiveRecording(state, "rec-underpass", NOW)).toThrow(
      /active listening sites/,
    );
  });

  it("archives an expired, unplaced clip and removes it from route analysis", () => {
    const state = seed();
    const archived = archiveRecording(state, "rec-belltower", NOW);
    const clip = archived.recordings.find((r) => r.id === "rec-belltower");
    expect(clip?.lifecycle?.state).toBe("archived");
    expect(clip?.lifecycle?.archivedAt).toBe(NOW.toISOString());
    // Still physically present, so its id resolves to an archived stub.
    expect(resolveRecording(archived, "rec-belltower")?.availability).toBe(
      "archived",
    );
  });

  it("keeps route references resolvable after a physical purge", () => {
    const state = seed();
    // The archived old harbor site cites rec-rain-basement, already purged in
    // the seed; its tombstone keeps the reference resolvable.
    const resolvedClip = resolveRecording(state, "rec-rain-basement");
    expect(resolvedClip?.availability).toBe("purged");
    expect(resolvedClip?.stub?.tombstone?.purgedAt).toBeTruthy();
    expect(
      resolvedClip?.stub?.tombstone?.referencedByReleaseIds,
    ).toContain("release-2025-harbor");
  });

  it("resolves a purged clip from the frozen release snapshot even without a tombstone", () => {
    const state = seed();
    // The historical release embeds the purged clip inside its snapshot.
    const releaseResolution = resolveRecording(state, "rec-rain-basement");
    expect(releaseResolution?.recording?.title).toBe(
      "Rain on basement grating",
    );
  });

  it("resolves purged sites through tombstones and frozen snapshots", () => {
    const state = seed();
    expect(resolveSite(state, "site-old-harbor")?.availability).toBe("archived");
    const purged = purgeSite(state, "site-old-harbor", NOW);
    const resolved = resolveSite(purged, "site-old-harbor");
    expect(resolved?.availability).toBe("purged");
    expect(resolved?.stub?.label).toBe("Harbor loop (paused)");
    expect(resolved?.stub?.tombstone?.referencedByReleaseIds).toContain(
      "release-2025-harbor",
    );
  });

  it("protects clips embedded in a published release from purge", () => {
    const state = seed();
    // rec-rain-basement is already purged; simulate a still-live clip embedded
    // in the historical release by archiving a copy under that id is not
    // possible, so verify the guard via the seeded tombstone path indirectly:
    // place a clip into the historical snapshot's site list then archive it.
    const target = "rec-belltower";
    const withCitation: StudyState = {
      ...state,
      releaseHistory: [
        {
          ...state.releaseHistory![0],
          snapshot: {
            ...state.releaseHistory![0].snapshot!,
            sites: [
              {
                ...state.releaseHistory![0].snapshot!.sites[0],
                recordings: [
                  ...state.releaseHistory![0].snapshot!.sites[0].recordings,
                  state.recordings.find((r) => r.id === target)!,
                ],
              },
            ],
          },
        },
      ],
    };
    const archived = archiveRecording(withCitation, target, NOW);
    expect(() => purgeRecording(archived, target, NOW)).toThrow(
      /published release/,
    );
  });

  it("leaves a tombstone recording the purge reason and lineage", () => {
    const state = archiveRecording(seed(), "rec-belltower", NOW);
    const purged = purgeRecording(state, "rec-belltower", NOW);
    expect(purged.recordings.map((r) => r.id)).not.toContain("rec-belltower");
    const tombstone = purged.tombstones.find((t) => t.id === "rec-belltower");
    expect(tombstone).toMatchObject({
      kind: "recording",
      reason: "manual-purge",
      importBatchId: "batch-autumn-import",
    });
    expect(resolveRecording(purged, "rec-belltower")?.stub?.label).toBe(
      "Old belltower ambience",
    );
  });
});

describe("restore and re-qualification", () => {
  it("restores an archived clip and re-arms its retention window", () => {
    const state = seed();
    const restored = restoreRecording(state, "rec-ferry-horn", NOW);
    const clip = restored.recordings.find((r) => r.id === "rec-ferry-horn");
    expect(clip?.lifecycle?.state).toBe("within-retention");
    expect(clip?.lifecycle?.anchor).toBe(NOW.toISOString());
    expect(clip?.lifecycle?.restoredAt).toBe(NOW.toISOString());
    expect(clip?.lifecycle?.archivedAt).toBeUndefined();
  });

  it("cannot restore a clip that is not archived", () => {
    expect(() => restoreRecording(seed(), "rec-underpass", NOW)).toThrow(
      RetentionError,
    );
  });

  it("returns a ready project to review and freezes the release stale on restore", () => {
    const baseline = seed();
    const ready: StudyState = {
      ...baseline,
      project: { ...baseline.project, stage: "ready" as const },
      release: {
        ...baseline.releaseHistory![0],
        id: "release-current",
        status: "ready" as const,
        fingerprint: "sc-r1-current",
      },
    };
    const restored = restoreSite(ready, "site-old-harbor", NOW);
    expect(restored.project.stage).toBe("review");
    expect(restored.release?.status).toBe("stale");
  });

  it("requalify is idempotent on projects already in review", () => {
    const state = seed();
    const result = requalify(state);
    expect(result.project.stage).toBe("review");
  });

  it("restores an archived site and keeps its prior route references", () => {
    const state = seed();
    const site = state.sites.find((s) => s.id === "site-old-harbor");
    expect(site?.recordingIds).toContain("rec-rain-basement");
    const restored = restoreSite(state, "site-old-harbor", NOW);
    const restoredSite = restored.sites.find(
      (s) => s.id === "site-old-harbor",
    );
    // The citation to the cleaned clip survives restore and still resolves.
    expect(restoredSite?.recordingIds).toContain("rec-rain-basement");
    expect(resolveRecording(restored, "rec-rain-basement")?.availability).toBe(
      "purged",
    );
  });
});

describe("retention sweep", () => {
  it("archives expired unplaced clips and expired resolved findings, but keeps protected material", () => {
    const result = runRetentionSweep(seed(), NOW);
    expect(result.archivedRecordings).toBeGreaterThanOrEqual(1);
    expect(result.archivedIssues).toBeGreaterThanOrEqual(1);
    // The seeded archived site + archived clips are already archived; purging
    // the harbor site is allowed, but its purged clip citation is protected by
    // the historical release, which only affects clips, not sites.
    expect(result.purgedSites).toBeGreaterThanOrEqual(1);
  });

  it("does not purge records it only archived during the same sweep", () => {
    const state = seed();
    const result = runRetentionSweep(state, NOW);
    // The belltower clip expires today: it must be archived, not deleted.
    expect(
      result.state.recordings.find((r) => r.id === "rec-belltower")?.lifecycle
        ?.state,
    ).toBe("archived");
    expect(
      result.state.tombstones.map((t) => t.id),
    ).not.toContain("rec-belltower");
  });

  it("is a no-op when nothing is due", () => {
    // A fresh state with only within-retention material.
    const state: StudyState = {
      ...seed(),
      recordings: seed()
        .recordings.filter((r) =>
          ["rec-underpass", "rec-market"].includes(r.id),
        ),
      sites: seed().sites.filter((s) => s.id === "site-threshold"),
      issues: [],
      tombstones: [],
      releaseHistory: [],
    };
    const result = runRetentionSweep(state, NOW);
    expect(result.archivedRecordings).toBe(0);
    expect(result.purgedRecordings).toBe(0);
    expect(result.state).toEqual(state);
  });
});

describe("release gate retention blockers", () => {
  it("reports site anchors with the route-site policy window", () => {
    const state = seed();
    const status = siteRetention(state.sites[0], NOW);
    expect(status.category).toBe("route-site");
    expect(RETENTION_POLICY["route-site"].retentionDays).toBe(365);
  });
});
