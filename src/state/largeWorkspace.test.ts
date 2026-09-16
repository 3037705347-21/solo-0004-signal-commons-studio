import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import { releaseFingerprint } from "../domain/releaseIdentity";
import { buildSiteChecklist } from "../domain/siteChecklist";
import {
  selectRecordingSite,
  selectRecordingsForSite,
  selectWorkspaceSummary,
} from "./selectors";
import { loadStudy, saveStudy } from "./persistence";
import { validateReferences } from "./migrations";
import { workspaceReducer } from "./reducer";
import type { Recording, Site, StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";

const ROLES = ["arrival", "texture", "voice", "departure"] as const;

function buildLargeWorkspace(
  recordingCount = 400,
  siteCount = 24,
): StudyState {
  const seed = createSeedStudy();
  const stamp = "2026-09-01T08:00:00.000Z";
  const recordings: Recording[] = Array.from(
    { length: recordingCount },
    (_unused, index) => ({
      id: `rec-bulk-${index}`,
      catalogId: `SC-BULK-${String(index).padStart(4, "0")}`,
      title: `Bulk field clip ${index}`,
      source: `Field team ${index % 8}`,
      recordedOn: "2026-08-15",
      format: index % 3 === 0 ? "FLAC" : "WAV",
      location: `Grid sector ${index % siteCount}`,
      summary: `Deterministic bulk fixture clip number ${index} used for scale consistency checks.`,
      audioSpec: {
        sampleRate: 48000,
        channels: 2,
        bitDepth: 24,
        durationSeconds: 60 + (index % 10) * 15,
      },
      signalRole: ROLES[index % ROLES.length],
      sensitivity: index % 17 === 0 ? "sensitive" : "public",
      transcriptStatus: index % 5 === 0 ? "draft" : "verified",
      consentStatus: index % 11 === 0 ? "pending" : "confirmed",
      isFeatured: index % 25 === 0,
      tags: [`sector-${index % siteCount}`, ROLES[index % ROLES.length]],
      color: "#445566",
      createdAt: stamp,
      updatedAt: stamp,
    }),
  );
  const sites: Site[] = Array.from({ length: siteCount }, (_unused, index) => {
    const isQuiet = index % 4 === 0;
    const assigned = recordings
      .filter((recording) => {
        const sector = Number(recording.id.split("-").pop()) % siteCount;
        return sector === index && (isQuiet || recording.sensitivity !== "sensitive");
      })
      .slice(0, 20);
    return {
      id: `site-bulk-${index}`,
      name: `Bulk listening sector ${index}`,
      shortLabel: `Sector ${index}`,
      prompt: `What does sector ${index} reveal at scale?`,
      maxDurationSeconds: 20 * 600,
      maxClips: 20,
      quietSpace: isQuiet,
      hasSeating: index % 2 === 0,
      color: "#445566",
      sequence: index,
      recordingIds: assigned.map((recording) => recording.id),
    };
  });

  return {
    ...seed,
    revision: 12,
    updatedAt: stamp,
    project: { ...seed.project, title: "Large scale fixture study" },
    recordings,
    sites,
    issues: [],
    release: null,
    auditLog: [],
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage,
  };
}

describe("large workspace consistency", () => {
  it("keeps every placed clip reachable from exactly one site across all readers", () => {
    const state = buildLargeWorkspace();
    const placement = new Map<string, string>();
    state.sites.forEach((site) => {
      site.recordingIds.forEach((id) => {
        expect(placement.has(id)).toBe(false);
        placement.set(id, site.id);
      });
    });

    const analysis = analyzeRoute(state.recordings, state.sites);
    const summary = selectWorkspaceSummary(state);
    expect(analysis.placedCount).toBe(placement.size);
    expect(summary.analysis.placedCount).toBe(placement.size);
    expect(
      analysis.placedCount + analysis.unplacedCount,
    ).toBe(state.recordings.length);

    state.sites.forEach((site) => {
      const viaSelector = selectRecordingsForSite(state, site.id);
      expect(viaSelector.map((clip) => clip.id)).toEqual(site.recordingIds);
      const checklist = buildSiteChecklist(state, site.id);
      expect(checklist).not.toBeNull();
      expect(checklist!.entries.map((entry) => entry.recordingId)).toEqual(
        site.recordingIds,
      );
      site.recordingIds.forEach((id) => {
        expect(selectRecordingSite(state, id)?.id).toBe(site.id);
      });
    });
  });

  it("round trips the full workspace through checksummed storage without a single clip or placement changing", () => {
    const state = buildLargeWorkspace();
    const { storage } = memoryStorage();
    expect(saveStudy(state, storage)).toBe(true);
    const reopened = loadStudy(storage);

    expect(reopened.recordings).toHaveLength(state.recordings.length);
    expect(reopened.sites).toHaveLength(state.sites.length);
    expect(reopened.sites.map((site) => site.recordingIds)).toEqual(
      state.sites.map((site) => site.recordingIds),
    );
    expect(reopened).toMatchObject({
      revision: state.revision,
      project: { title: state.project.title },
    });
    expect(releaseFingerprint(reopened)).toBe(releaseFingerprint(state));
    expect(analyzeRoute(reopened.recordings, reopened.sites).placedCount).toBe(
      analyzeRoute(state.recordings, state.sites).placedCount,
    );
  });

  it("applies hundreds of sequential commands with a strictly monotonic revision and stable reads", () => {
    let state: StudyState = buildLargeWorkspace(120, 6);
    const startRevision = state.revision;
    for (let index = 0; index < 120; index += 1) {
      state = workspaceReducer(state, {
        type: "preferences/update",
        preferences: {
          ...state.preferences,
          listenerCount: 1 + (index % 20),
        },
        meta: {
          commandId: `bulk-cmd-${index}`,
          expectedRevision: state.revision,
          originId: "bulk-tab",
          issuedAt: `2026-09-0${1 + (index % 9)}T12:00:00.000Z`,
        },
      });
      expect(state.revision).toBe(startRevision + index + 1);
    }
    expect(state.revision).toBe(startRevision + 120);
    // Route facts remain untouched by preference commands, and readers agree.
    const analysis = analyzeRoute(state.recordings, state.sites);
    state.sites.forEach((site) => {
      expect(selectRecordingsForSite(state, site.id).map((c) => c.id)).toEqual(
        site.recordingIds,
      );
    });
    const checklists = state.sites.map((site) =>
      buildSiteChecklist(state, site.id)?.entries.length,
    );
    expect(checklists.reduce((sum, count) => sum! + count!, 0)).toBe(
      analysis.placedCount,
    );
  });

  it("survives startup validation on a large workspace with injected dangling and duplicate references", () => {
    const state = buildLargeWorkspace(300, 12);
    const sites = state.sites.map((site, index) => {
      if (index % 3 !== 0 || site.recordingIds.length === 0) return site;
      const victim = site.recordingIds[0];
      return {
        ...site,
        recordingIds: [...site.recordingIds, "rec-ghost", victim],
      };
    });
    const damaged = { ...state, sites };
    const repaired = validateReferences(damaged);

    let placed = 0;
    const seen = new Set<string>();
    repaired.sites.forEach((site) => {
      site.recordingIds.forEach((id) => {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(repaired.recordings.some((recording) => recording.id === id)).toBe(
          true,
        );
        placed += 1;
      });
    });
    expect(analyzeRoute(repaired.recordings, repaired.sites).placedCount).toBe(
      placed,
    );
    // Repair must be a fixed point.
    expect(validateReferences(repaired)).toEqual(repaired);
  });

  it("derives a deterministic fingerprint regardless of array ordering", () => {
    const state = buildLargeWorkspace(120, 6);
    const reordered: StudyState = {
      ...state,
      recordings: [...state.recordings].reverse(),
      sites: [...state.sites].reverse(),
    };
    expect(releaseFingerprint(reordered)).toBe(releaseFingerprint(state));
  });
});
