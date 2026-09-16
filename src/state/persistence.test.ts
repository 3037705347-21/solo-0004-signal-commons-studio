import { describe, expect, it } from "vitest";
import {
  clearWorkspace,
  loadStudy,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import { createSeedStudy } from "./seed";

describe("workspace persistence", () => {
  it("falls back to seed state for malformed storage", () => {
    const storage = { getItem: () => "{bad json" } as unknown as Storage;
    expect(loadStudy(storage).version).toBe(3);
  });
  it("round trips a workspace through storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage;
    const state = createSeedStudy();
    expect(saveStudy(state, storage)).toBe(true);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadStudy(storage).project.title).toBe(state.project.title);
    clearWorkspace(storage);
    expect(values.has(STORAGE_KEY)).toBe(false);
  });

  it("migrates a version 1 workspace into the current state contract", () => {
    const legacy = createSeedStudy();
    const raw = JSON.stringify({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      auditLog: undefined,
      release: undefined,
      releaseHistory: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
    expect(migrated.releaseHistory).toEqual([]);
  });

  it("migrates a version 2 workspace, preserving its release as immutable history", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      version: 2,
      releaseHistory: undefined,
      draftSourceReleaseId: undefined,
      release: {
        id: "release-old",
        sequence: 7,
        createdAt: "2026-09-09T09:00:00.000Z",
        status: "stale",
        revision: 4,
        fingerprint: "sc-r1-deadbeef",
        readiness: {
          ready: true,
          score: 100,
          blockers: [],
          cautions: [],
          checkedAt: "2026-09-09T09:00:00.000Z",
        },
        snapshot: {
          schemaVersion: 2,
          generatedAt: "2026-09-09T09:00:00.000Z",
          releaseId: "release-old",
          releaseSequence: 7,
          revision: 4,
          fingerprint: "sc-r1-deadbeef",
          project: seed.project,
          preferences: seed.preferences,
          summary: {
            recordingCount: seed.recordings.length,
            siteCount: seed.sites.length,
            routeSeconds: 600,
            readinessScore: 100,
          },
          sites: [],
          unresolvedIssues: [],
        },
      },
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.releaseHistory).toHaveLength(1);
    // The live head keeps its recovered stale marker; the history copy
    // preserves the "ready" status it was evaluated with.
    expect(migrated.release?.status).toBe("stale");
    expect(migrated.releaseHistory[0].status).toBe("ready");
    expect(migrated.releaseHistory[0].sequence).toBe(7);
    expect(migrated.releaseHistory[0].content).toBeUndefined();
  });

  it("rejects structurally valid JSON with invalid nested domain fields", () => {
    const malformed = createSeedStudy();
    malformed.recordings[0].audioSpec.durationSeconds = -1;
    const storage = {
      getItem: () => JSON.stringify(malformed),
    } as unknown as Storage;
    expect(loadStudy(storage).project.title).toBe(
      createSeedStudy().project.title,
    );
  });

  it("recovers the previous checksummed state when the primary record is damaged", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage;
    const first = {
      ...createSeedStudy(),
      project: { ...createSeedStudy().project, title: "Recovered baseline" },
    };
    const second = {
      ...first,
      project: { ...first.project, title: "Current baseline" },
    };

    expect(saveStudy(first, storage)).toBe(true);
    expect(saveStudy(second, storage)).toBe(true);
    expect(values.has(STORAGE_BACKUP_KEY)).toBe(true);
    expect(values.get(STORAGE_BACKUP_KEY)).toContain("Recovered baseline");
    values.set(STORAGE_KEY, "{broken primary");

    expect(loadStudy(storage).project.title).toBe("Recovered baseline");
  });
});
