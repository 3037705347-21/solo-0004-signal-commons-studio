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

  it("persists a withdrawal grant with no authorized purposes", () => {
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
    const state: ReturnType<typeof createSeedStudy> = {
      ...createSeedStudy(),
      consents: [
        ...createSeedStudy().consents,
        {
          id: "grant-withdraw-roundtrip",
          recordingId: "rec-bus",
          status: "withdrawn",
          purposes: [],
          grantedBy: "Milo Chen",
          channel: "Email",
          evidenceRef: "NOTE-RT",
          note: "Withdrawn.",
          grantedAt: "2026-09-15",
          createdAt: "2026-09-15T10:00:00.000Z",
        },
      ],
    };
    saveStudy(state, storage);
    const loaded = loadStudy(storage);
    const grant = loaded.consents.find(
      (item) => item.id === "grant-withdraw-roundtrip",
    );
    expect(grant?.status).toBe("withdrawn");
    expect(grant?.purposes).toEqual([]);
    expect(
      loaded.recordings.find((recording) => recording.id === "rec-bus")
        ?.consentStatus,
    ).toBe("withdrawn");
  });

  it("migrates a version 1 workspace into the version 3 state contract", () => {
    const legacy = createSeedStudy();
    const raw = JSON.stringify({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      consents: undefined,
      auditLog: undefined,
      release: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(0);
    expect(migrated.auditLog).toEqual([]);
    expect(migrated.release).toBeNull();
    // Pre-ledger confirmed/restricted consent is synthesized into the ledger,
    // pending clips intentionally get no grant.
    const recordingIds = new Set(migrated.recordings.map((item) => item.id));
    const grantRecordingIds = new Set(
      migrated.consents.map((grant) => grant.recordingId),
    );
    expect(recordingIds.size).toBeGreaterThan(0);
    expect(grantRecordingIds.size).toBeGreaterThan(0);
    migrated.recordings.forEach((recording) => {
      expect(grantRecordingIds.has(recording.id)).toBe(
        recording.consentStatus !== "pending",
      );
    });
  });

  it("migrates a version 2 workspace while preserving its revision", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      version: 2,
      consents: undefined,
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(seed.revision);
    expect(migrated.consents.length).toBeGreaterThan(0);
  });

  it("expires consent that has lapsed when reconciling a loaded workspace", () => {
    const seed = createSeedStudy();
    const storage = {
      getItem: () =>
        JSON.stringify({
          ...seed,
          consents: [
            {
              ...seed.consents[0],
              expiresAt: "2020-01-01",
            },
          ].filter((grant) => grant.recordingId === "rec-underpass"),
        }),
    } as unknown as Storage;
    const loaded = loadStudy(storage);
    const underpass = loaded.recordings.find(
      (recording) => recording.id === "rec-underpass",
    );
    expect(underpass?.consentStatus).toBe("expired");
    // Other clips with no surviving grant reconcile back to pending.
    const market = loaded.recordings.find(
      (recording) => recording.id === "rec-market",
    );
    expect(market?.consentStatus).toBe("pending");
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
