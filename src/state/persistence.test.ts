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
      handoffs: undefined,
      activeBaseline: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
    expect(migrated.handoffs).toEqual([]);
    expect(migrated.activeBaseline).toBeNull();
  });

  it("migrates a version 2 workspace into version 3 without losing content", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      version: 2,
      handoffs: undefined,
      activeBaseline: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.recordings).toHaveLength(seed.recordings.length);
    expect(migrated.handoffs).toEqual([]);
    expect(migrated.activeBaseline).toBeNull();
  });

  it("round trips a pending handoff through checksummed storage", () => {
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
    const seed = createSeedStudy();
    const pending: typeof seed = {
      ...seed,
      activeBaseline: {
        revision: 0,
        capturedAt: "2026-09-12T08:00:00.000Z",
        recordingIds: seed.recordings.map((r) => r.id),
        siteSequences: Object.fromEntries(
          seed.sites.map((site) => [site.id, [...site.recordingIds]]),
        ),
        issueIds: seed.issues.map((issue) => issue.id),
      },
      handoffs: [
        {
          id: "handoff-test",
          sequence: 1,
          status: "pending",
          outgoingName: "Lin Qiao",
          outgoingRole: "Night capture",
          incomingName: "Amina Patel",
          note: "Cold night.",
          baseline: {
            revision: 0,
            capturedAt: "2026-09-12T08:00:00.000Z",
            recordingIds: seed.recordings.map((r) => r.id),
            siteSequences: Object.fromEntries(
              seed.sites.map((site) => [site.id, [...site.recordingIds]]),
            ),
            issueIds: seed.issues.map((issue) => issue.id),
          },
          changes: [
            {
              id: "change-1",
              kind: "recording-added",
              summary: "New clip SC-X",
              recordingId: "rec-x",
              revision: 2,
              at: "2026-09-12T21:00:00.000Z",
            },
          ],
          openItems: [
            {
              id: "item-1",
              title: "Check wind",
              detail: "Re-record if distorted.",
              severity: "warning",
              status: "pending",
              createdAt: "2026-09-12T21:05:00.000Z",
            },
          ],
          revisionRange: { from: 0, to: 2 },
          createdAt: "2026-09-12T21:10:00.000Z",
        },
      ],
    };
    saveStudy(pending, storage);
    const loaded = loadStudy(storage);
    expect(loaded.handoffs).toHaveLength(1);
    expect(loaded.handoffs[0].status).toBe("pending");
    expect(loaded.activeBaseline?.revision).toBe(0);
    expect(loaded.handoffs[0].openItems[0].title).toBe("Check wind");
  });

  it("keeps an open session baseline across a reload even before the packet exists", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      activeBaseline: {
        revision: 0,
        capturedAt: "2026-09-12T08:00:00.000Z",
        recordingIds: [],
        siteSequences: {},
        issueIds: [],
      },
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    expect(loadStudy(storage).activeBaseline?.capturedAt).toBe(
      "2026-09-12T08:00:00.000Z",
    );
  });

  it("ignores a malformed session baseline", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      activeBaseline: { revision: "bad" },
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    expect(loadStudy(storage).activeBaseline).toBeNull();
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
