import { describe, expect, it } from "vitest";
import {
  BATCH_DRAFT_KEY,
  clearWorkspace,
  loadBatchDraft,
  loadStudy,
  saveBatchDraft,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import type { BatchDraftRecord } from "./persistence";
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

  it("migrates a v2 workspace that predates the import ledger", () => {
    const seed = createSeedStudy();
    const { imports: _imports, ...legacyShape } = seed;
    void _imports;
    const storage = {
      getItem: () => JSON.stringify(legacyShape),
    } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.imports).toEqual([]);
  });

  it("dedupes malformed or repeated import receipts during migration", () => {
    const seed = createSeedStudy();
    const raw = JSON.stringify({
      ...seed,
      imports: [
        {
          batchKey: "batch-a",
          label: "Sweep A",
          receivedAt: "2026-09-12T10:00:00.000Z",
          commandId: "cmd-1",
          revision: 1,
          recordingCount: 2,
          placementCount: 0,
          issueCount: 0,
          skippedCount: 0,
          catalogIds: ["SC-26-901"],
        },
        { batchKey: "broken" },
        {
          batchKey: "batch-a",
          label: "Sweep A duplicate",
          receivedAt: "2026-09-13T10:00:00.000Z",
          commandId: "cmd-2",
          revision: 2,
          recordingCount: 3,
          placementCount: 0,
          issueCount: 0,
          skippedCount: 0,
          catalogIds: [],
        },
      ],
    });
    const storage = { getItem: () => raw } as unknown as Storage;
    const migrated = loadStudy(storage);
    expect(migrated.imports).toHaveLength(1);
    expect(migrated.imports[0].label).toBe("Sweep A");
  });
});

describe("batch draft persistence", () => {
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

  const sessionDraft = {
    savedAt: "2026-09-12T10:00:00.000Z",
    step: "review" as const,
    session: {
      batchId: "sweep-draft",
      label: "Draft sweep",
      fileErrors: [] as unknown[],
      rows: [
        {
          kind: "recording" as const,
          rowId: "recording-1",
          draft: {
            catalogId: "SC-26-921",
            title: "Draft clip",
            source: "Lin",
            recordedOn: "2026-09-10",
            format: "WAV",
            location: "Pier",
            summary: "A long enough summary describing the harbor sound.",
            sampleRate: "48000",
            channels: "2",
            bitDepth: "24",
            durationSeconds: "100",
            signalRole: "arrival" as const,
            sensitivity: "public" as const,
            transcriptStatus: "draft" as const,
            consentStatus: "pending" as const,
            isFeatured: false,
            tags: "",
            color: "#2f7c75",
          },
        },
      ],
    },
  };

  it("round trips an in-progress review draft", () => {
    const { values, storage } = memoryStorage();
    expect(saveBatchDraft(sessionDraft as BatchDraftRecord, storage)).toBe(true);
    expect(values.has(BATCH_DRAFT_KEY)).toBe(true);
    const loaded = loadBatchDraft(storage);
    expect(loaded?.step).toBe("review");
    expect(loaded?.session?.rows).toHaveLength(1);
  });

  it("keeps the pasted compose-step source so reviewers resume where they stopped", () => {
    const { storage } = memoryStorage();
    saveBatchDraft(
      { savedAt: "2026-09-12T10:00:00.000Z", step: "compose", rawText: '{"x":1}' },
      storage,
    );
    expect(loadBatchDraft(storage)?.rawText).toBe('{"x":1}');
  });

  it("keeps a draft whose file has no readable rows so the defect stays visible", () => {
    const { storage } = memoryStorage();
    saveBatchDraft(
      {
        savedAt: "2026-09-12T10:00:00.000Z",
        step: "review",
        session: {
          batchId: "broken",
          label: "Broken shipment",
          rows: [],
          fileErrors: [{ ref: "recordings", message: "“recordings” must be a list." }],
        },
      },
      storage,
    );
    const loaded = loadBatchDraft(storage);
    expect(loaded?.session?.fileErrors).toHaveLength(1);
    expect(loaded?.session?.rows).toHaveLength(0);
  });

  it("ignores corrupt draft contents", () => {
    const storage = { getItem: () => "{broken" } as unknown as Storage;
    expect(loadBatchDraft(storage)).toBeNull();
  });

  it("clears the draft together with the workspace", () => {
    const { values, storage } = memoryStorage();
    saveStudy(createSeedStudy(), storage);
    saveBatchDraft(sessionDraft as BatchDraftRecord, storage);
    clearWorkspace(storage);
    expect(values.has(BATCH_DRAFT_KEY)).toBe(false);
    expect(values.has(STORAGE_KEY)).toBe(false);
  });
});
