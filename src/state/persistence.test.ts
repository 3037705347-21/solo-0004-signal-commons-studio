import { describe, expect, it } from "vitest";
import {
  clearWorkspace,
  commitWorkspace,
  loadDrafts,
  loadStudy,
  loadConflicts,
  saveConflicts,
  saveDrafts,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import { createId } from "../domain/ids";
import { createSeedStudy } from "./seed";

describe("workspace persistence", () => {
  it("falls back to seed state for malformed storage", () => {
    const storage = { getItem: () => "{bad json" } as unknown as Storage;
    expect(loadStudy(storage).version).toBe(2);
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

  function makeMemoryStorage() {
    const values = new Map<string, string>();
    return {
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

  it("refuses to overwrite a record another tab committed after the expected revision", () => {
    const { storage } = makeMemoryStorage();
    const baseline = createSeedStudy();
    const committed = {
      ...structuredClone(baseline),
      revision: 5,
      updatedAt: "2026-09-12T09:00:00.000Z",
    };
    saveStudy(committed, storage);
    const localEdit = {
      ...structuredClone(baseline),
      revision: 1,
      updatedAt: "2026-09-12T08:00:00.000Z",
    };

    const outcome = commitWorkspace(
      localEdit,
      `${baseline.revision}|${baseline.updatedAt}`,
      storage,
    );

    expect(outcome.status).toBe("diverged");
    if (outcome.status === "diverged")
      expect(outcome.committed.revision).toBe(5);
    expect(loadStudy(storage).revision).toBe(5);
  });

  it("commits when the stored record still matches the expected signature", () => {
    const { storage } = makeMemoryStorage();
    const baseline = createSeedStudy();
    saveStudy(baseline, storage);
    const next = {
      ...structuredClone(baseline),
      revision: 1,
      updatedAt: "2026-09-12T08:00:00.000Z",
    };

    const outcome = commitWorkspace(
      next,
      `${baseline.revision}|${baseline.updatedAt}`,
      storage,
    );
    expect(outcome.status).toBe("committed");
    expect(loadStudy(storage).revision).toBe(1);
  });

  it("round trips conflict records and parked drafts with their state snapshots", () => {
    const base = createSeedStudy();
    const ours = {
      ...structuredClone(base),
      revision: 6,
      updatedAt: "2026-09-12T08:00:00.000Z",
    };
    const theirs = {
      ...structuredClone(base),
      revision: 7,
      updatedAt: "2026-09-12T09:00:00.000Z",
    };
    const conflict = {
      id: createId("conflict"),
      detectedAt: "2026-09-12T09:01:00.000Z",
      originId: "tab-a",
      originLabel: "This tab",
      commandSummary: "Saved clip",
      baseRevision: 5,
      oursRevision: 6,
      theirsRevision: 7,
      base,
      ours,
      theirs,
    };
    const { storage } = makeMemoryStorage();
    saveConflicts([conflict], storage);
    const reloaded = loadConflicts(storage);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].theirsRevision).toBe(7);
    expect(reloaded[0].ours.revision).toBe(6);

    const draft = {
      id: createId("draft"),
      createdAt: "2026-09-12T09:02:00.000Z",
      originId: "tab-a",
      commandSummary: "Saved clip",
      baseRevision: 5,
      theirsRevision: 7,
      base,
      ours,
      theirs,
    };
    saveDrafts([draft], storage);
    expect(loadDrafts(storage)[0].commandSummary).toBe("Saved clip");
  });
});
