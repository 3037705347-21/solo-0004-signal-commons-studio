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

  it("migrates a version 1 workspace into the version 3 state contract", () => {
    const legacy = createSeedStudy();
    const raw = JSON.stringify({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      auditLog: undefined,
      release: undefined,
      ruleVersions: undefined,
      activeRuleVersionId: undefined,
      pendingRuleChange: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
    expect(migrated.activeRuleVersionId).toBe(migrated.ruleVersions[0].id);
    expect(migrated.pendingRuleChange).toBeNull();
    expect(migrated.ruleVersions[0].rules.capacityWarnAt).toBeCloseTo(0.8);
  });

  it("keeps a v2 published snapshot frozen under its historical baseline rules", () => {
    const seed = createSeedStudy();
    const snapshotV2 = {
      schemaVersion: 2,
      generatedAt: "2026-09-01T10:00:00.000Z",
      releaseId: "release-legacy-1",
      releaseSequence: 1,
      revision: 0,
      fingerprint: "legacy-fingerprint",
      project: seed.project,
      preferences: seed.preferences,
      summary: {
        recordingCount: seed.recordings.length,
        siteCount: seed.sites.length,
        routeSeconds: 400,
        readinessScore: 100,
      },
      sites: [],
      unresolvedIssues: [],
    };
    const legacy = {
      ...seed,
      version: 2,
      release: {
        id: "release-legacy-1",
        sequence: 1,
        createdAt: "2026-09-01T10:00:00.000Z",
        status: "ready",
        revision: 0,
        fingerprint: "legacy-fingerprint",
        readiness: {
          ready: true,
          score: 100,
          blockers: [],
          cautions: [],
          checkedAt: "2026-09-01T10:00:00.000Z",
        },
        snapshot: snapshotV2,
      },
      ruleVersions: undefined,
      activeRuleVersionId: undefined,
      pendingRuleChange: undefined,
    };
    const storage = {
      getItem: () => JSON.stringify(legacy),
    } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.release?.snapshot?.schemaVersion).toBe(3);
    expect(migrated.release?.snapshot?.ruleVersion.label).toMatch(/baseline/i);
    expect(migrated.release?.snapshot?.ruleVersion.rules.sensitivePolicy).toBe(
      "review-warning",
    );
    expect(migrated.release?.ruleVersionId).toBe(
      migrated.ruleVersions[0].id,
    );
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
