import { describe, expect, it } from "vitest";
import {
  clearWorkspace,
  commitStudy,
  diskAheadOf,
  loadStudy,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import { createSeedStudy } from "./seed";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as unknown as Storage,
  };
}

describe("workspace persistence", () => {
  it("falls back to seed state for malformed storage", () => {
    const storage = { getItem: () => "{bad json" } as unknown as Storage;
    expect(loadStudy(storage).version).toBe(2);
  });
  it("round trips a workspace through storage", () => {
    const { values, storage } = memoryStorage();
    const state = createSeedStudy();
    expect(saveStudy(state, storage)).toBe(true);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadStudy(storage).project.title).toBe(state.project.title);
    clearWorkspace(storage);
    expect(values.has(STORAGE_KEY)).toBe(false);
  });

  it("migrates a version 1 workspace into the version 2 state contract", () => {
    const legacy = createSeedStudy();
    const raw = JSON.stringify({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      auditLog: undefined,
      release: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(2);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
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
    const { values, storage } = memoryStorage();
    const first = {
      ...createSeedStudy(),
      revision: 1,
      updatedAt: "2026-09-10T10:00:00.000Z",
      project: { ...createSeedStudy().project, title: "Recovered baseline" },
    };
    const second = {
      ...first,
      revision: 2,
      updatedAt: "2026-09-10T11:00:00.000Z",
      project: { ...first.project, title: "Current baseline" },
    };

    expect(saveStudy(first, storage)).toBe(true);
    expect(saveStudy(second, storage)).toBe(true);
    expect(values.has(STORAGE_BACKUP_KEY)).toBe(true);
    expect(values.get(STORAGE_BACKUP_KEY)).toContain("Recovered baseline");
    values.set(STORAGE_KEY, "{broken primary");

    expect(loadStudy(storage).project.title).toBe("Recovered baseline");
  });

  describe("concurrent commit guard", () => {
    it("refuses to overwrite a newer on-disk revision and returns the winner", () => {
      const { storage } = memoryStorage();
      const base = createSeedStudy();
      const committed = {
        ...base,
        revision: 3,
        updatedAt: "2026-09-10T12:00:00.000Z",
        project: { ...base.project, title: "Committed elsewhere" },
      };
      expect(commitStudy(committed, storage).outcome).toBe("saved");

      const stale = {
        ...base,
        revision: 1,
        updatedAt: "2026-09-10T09:00:00.000Z",
        project: { ...base.project, title: "Stale branch" },
      };
      const result = commitStudy(stale, storage);
      expect(result.outcome).toBe("disk-ahead");
      if (result.outcome === "disk-ahead") {
        expect(result.disk.project.title).toBe("Committed elsewhere");
      }
      expect(loadStudy(storage).project.title).toBe("Committed elsewhere");
    });

    it("allows a state that chains from the current disk revision", () => {
      const { storage } = memoryStorage();
      const base = createSeedStudy();
      const first = {
        ...base,
        revision: 1,
        updatedAt: "2026-09-10T10:00:00.000Z",
      };
      const next = {
        ...first,
        revision: 2,
        updatedAt: "2026-09-10T11:00:00.000Z",
        project: { ...first.project, title: "Chained commit" },
      };
      expect(commitStudy(first, storage).outcome).toBe("saved");
      expect(commitStudy(next, storage).outcome).toBe("saved");
      expect(loadStudy(storage).project.title).toBe("Chained commit");
    });

    it("treats diverged content at the same revision as a conflict", () => {
      const { storage } = memoryStorage();
      const winner = {
        ...createSeedStudy(),
        revision: 4,
        updatedAt: "2026-09-10T12:00:00.000Z",
        project: {
          ...createSeedStudy().project,
          title: "Readiness frozen in another tab",
        },
      };
      expect(commitStudy(winner, storage).outcome).toBe("saved");

      const diverged = {
        ...winner,
        updatedAt: "2026-09-10T12:05:00.000Z",
        preferences: { ...winner.preferences, listenerCount: 11 },
      };
      expect(commitStudy(diverged, storage).outcome).toBe("disk-ahead");
      expect(loadStudy(storage).preferences.listenerCount).toBe(
        winner.preferences.listenerCount,
      );
    });

    it("reports a quota error without touching the committed record", () => {
      const values = new Map<string, string>();
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: () => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        },
      } as unknown as Storage;
      const state = createSeedStudy();
      const result = commitStudy(state, storage);
      expect(result.outcome).toBe("quota-error");
      expect(saveStudy(state, storage)).toBe(false);
    });

    it("compares revisions directly through the diskAheadOf predicate", () => {
      const base = createSeedStudy();
      const older = { ...base, revision: 1 };
      const newer = { ...base, revision: 2 };
      expect(diskAheadOf(newer, older)).toBe(true);
      expect(diskAheadOf(older, newer)).toBe(false);
      expect(diskAheadOf(null, newer)).toBe(false);
    });
  });
});
