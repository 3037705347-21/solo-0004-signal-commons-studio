import { describe, expect, it } from "vitest";
import { analyzeRoute } from "../domain/routeAnalysis";
import {
  buildReleaseSnapshot,
  isReleaseCurrent,
} from "../domain/releaseRules";
import { buildSiteChecklist } from "../domain/siteChecklist";
import { releaseFingerprint } from "../domain/releaseIdentity";
import {
  selectRecordingsForSite,
  selectRecordingSite,
} from "./selectors";
import {
  loadStudy,
  saveStudy,
  STORAGE_BACKUP_KEY,
  STORAGE_KEY,
} from "./persistence";
import { migrateWorkspace, validateReferences } from "./migrations";
import { createSeedStudy } from "./seed";
import type { StudyState } from "../domain/models";

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
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

function envelopeFor(state: StudyState, checksum?: string): string {
  const stateJson = JSON.stringify(state);
  return JSON.stringify({
    storageVersion: 1,
    checksum: checksum ?? "00000000",
    stateJson,
  });
}

function checksumOf(raw: string): string {
  // mirror of persistence fnv1a envelope layout
  const parsed = JSON.parse(raw) as { stateJson: string };
  let hash = 0x811c9dc5;
  for (let index = 0; index < parsed.stateJson.length; index += 1) {
    hash ^= parsed.stateJson.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

describe("abnormal shutdown recovery", () => {
  it("returns the last committed fact when the most recent write is torn (simulated crash before primary write completes)", () => {
    const { values, storage } = memoryStorage();
    const baseline = createSeedStudy();
    saveStudy(baseline, storage);
    const afterEdit: StudyState = {
      ...baseline,
      project: { ...baseline.project, title: "Title edited right before crash" },
    };
    saveStudy(afterEdit, storage);
    const committedPrimary = values.get(STORAGE_KEY)!;
    const committedBackup = values.get(STORAGE_BACKUP_KEY)!;
    // A second edit starts: backup rotated to the first edit's record, then the
    // process is killed after backup rotation but with a torn primary.
    const inFlight: StudyState = {
      ...afterEdit,
      project: { ...afterEdit.project, title: "In-flight title never committed" },
    };
    saveStudy(inFlight, storage);
    values.set(STORAGE_KEY, "{");
    // Backup must still be the committed record, never the torn in-flight one.
    expect(values.get(STORAGE_BACKUP_KEY)).toBe(committedPrimary);
    expect(committedBackup).not.toContain("In-flight title");

    const recovered = loadStudy(storage);
    expect(recovered.project.title).toBe("Title edited right before crash");
  });

  it("does not lose more than one revision when recovering from backup", () => {
    const { values, storage } = memoryStorage();
    const states: StudyState[] = [];
    for (let revision = 0; revision < 5; revision += 1) {
      const previous = states.at(-1) ?? createSeedStudy();
      const next: StudyState = {
        ...previous,
        revision,
        updatedAt: `2026-09-1${revision}T08:00:00.000Z`,
        preferences: { ...previous.preferences, listenerCount: revision },
      };
      states.push(next);
      saveStudy(next, storage);
    }
    // Torn final primary: saveStudy always leaves the penultimate committed
    // record in backup, so recovery loses at most that final revision.
    values.set(STORAGE_KEY, "not-json");
    const recovered = loadStudy(storage);
    expect(recovered.preferences.listenerCount).toBe(3);
    expect(recovered.revision).toBe(3);
  });

  it("presents identical facts across every reader after reopening from a recovered backup", () => {
    const { values, storage } = memoryStorage();
    const state = createSeedStudy();
    saveStudy(state, storage);
    saveStudy(
      {
        ...state,
        project: { ...state.project, title: "Consistency across reopen" },
      },
      storage,
    );
    values.set(STORAGE_KEY, "{torn primary");

    const reopened = loadStudy(storage);
    const reloaded = loadStudy(storage);
    for (const candidate of [reopened, reloaded]) {
      expect(candidate.project.title).toBe("Signal Commons: Listening Across the City");
      candidate.sites.forEach((site) => {
        const clips = selectRecordingsForSite(candidate, site.id);
        expect(clips.map((clip) => clip.id)).toEqual(site.recordingIds);
        site.recordingIds.forEach((id) => {
          expect(selectRecordingSite(candidate, id)?.id).toBe(site.id);
        });
      });
      const checklist = buildSiteChecklist(candidate, candidate.sites[0].id);
      expect(checklist?.entries.map((entry) => entry.recordingId)).toEqual(
        candidate.sites[0].recordingIds,
      );
      const analysis = analyzeRoute(candidate.recordings, candidate.sites);
      expect(analysis.placedCount + analysis.unplacedCount).toBe(
        candidate.recordings.length,
      );
    }
  });

  it("falls back to seed data deterministically when both primary and backup are corrupt", () => {
    const { storage } = memoryStorage({
      [STORAGE_KEY]: "{broken",
      [STORAGE_BACKUP_KEY]: "also broken",
    });
    const first = loadStudy(storage);
    const second = loadStudy(storage);
    const seed = createSeedStudy();
    expect(first.project.title).toBe(seed.project.title);
    expect(first.revision).toBe(seed.revision);
    // Repeated recovery attempts must be stable, not drift with Date.now().
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("ignores a checksummed envelope whose checksum does not match the payload", () => {
    const tampered = createSeedStudy();
    const { storage } = memoryStorage({
      [STORAGE_KEY]: envelopeFor(tampered, "deadbeef"),
    });
    const recovered = loadStudy(storage);
    expect(recovered.project.title).toBe(createSeedStudy().project.title);
  });

  it("prefers an intact primary over an older backup", () => {
    const { storage } = memoryStorage();
    const older = {
      ...createSeedStudy(),
      project: { ...createSeedStudy().project, title: "Older backup title" },
    };
    const newer = {
      ...older,
      project: { ...older.project, title: "Newer primary title" },
    };
    saveStudy(older, storage);
    saveStudy(newer, storage);
    expect(loadStudy(storage).project.title).toBe("Newer primary title");
  });
});

describe("recovery failure when neither record is trustworthy", () => {
  it("never returns a structurally invalid nested record even if its checksum matches", () => {
    // A checksum only proves the bytes were not torn; the content must still
    // pass schema validation. Build an envelope whose checksum is internally
    // consistent but whose payload carries an invalid audio spec.
    const malformed = createSeedStudy();
    malformed.recordings[0] = {
      ...malformed.recordings[0],
      audioSpec: { ...malformed.recordings[0].audioSpec, durationSeconds: 0 },
    };
    const raw = envelopeFor(malformed);
    const { storage } = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        ...JSON.parse(raw),
        checksum: checksumOf(raw),
      }),
    });
    const recovered = loadStudy(storage);
    expect(recovered.recordings.every((r) => r.audioSpec.durationSeconds > 0)).toBe(true);
    expect(recovered.project.title).toBe(createSeedStudy().project.title);
  });

  it("repairs dangling and duplicate route references during startup validation and keeps the same fact on reload", () => {
    const state = createSeedStudy();
    const withDangling: StudyState = {
      ...state,
      sites: state.sites.map((site, index) =>
        index === 0
          ? {
              ...site,
              recordingIds: [
                ...site.recordingIds,
                "rec-does-not-exist",
                site.recordingIds[0],
              ],
            }
          : site,
      ),
    };
    const repaired = validateReferences(withDangling);
    const firstSite = repaired.sites[0];
    expect(firstSite.recordingIds).not.toContain("rec-does-not-exist");
    expect(firstSite.recordingIds.filter((id) => id === state.sites[0].recordingIds[0]))
      .toHaveLength(1);
    // Repair is idempotent: revalidating changes nothing further.
    expect(validateReferences(repaired)).toEqual(repaired);
    // And a round trip through storage preserves the repaired fact.
    const { storage } = memoryStorage();
    saveStudy(repaired, storage);
    const reloaded = loadStudy(storage);
    expect(reloaded.sites[0].recordingIds).toEqual(firstSite.recordingIds);
  });

  it("marks a stored ready release stale when persisted content no longer matches its fingerprint", () => {
    const ready = createSeedStudy();
    const fingerprint = releaseFingerprint(ready);
    const analysis = analyzeRoute(ready.recordings, ready.sites);
    const snapshot = buildReleaseSnapshot(
      ready,
      analysis,
      {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-09-09T12:00:00.000Z",
      },
      "release-stale-on-disk",
      1,
    );
    const staleStored: StudyState = {
      ...ready,
      release: {
        id: "release-stale-on-disk",
        sequence: 1,
        createdAt: "2026-09-09T12:00:00.000Z",
        status: "ready",
        revision: ready.revision,
        fingerprint,
        readiness: {
          ready: true,
          score: 100,
          blockers: [],
          cautions: [],
          checkedAt: "2026-09-09T12:00:00.000Z",
        },
        snapshot,
      },
      // tamper with release-relevant content after the freeze
      preferences: { ...ready.preferences, listenerCount: 42 },
    };
    const { storage } = memoryStorage();
    saveStudy(staleStored, storage);
    const reopened = loadStudy(storage);
    expect(reopened.release?.status).toBe("stale");
    expect(isReleaseCurrent(reopened, reopened.release)).toBe(false);
  });
});

describe("legacy version 1 data", () => {
  it("migrates legacy data and exposes the same facts through every page reader", () => {
    const legacy = createSeedStudy();
    const migrated = migrateWorkspace({
      ...legacy,
      version: 1,
      revision: undefined,
      updatedAt: undefined,
      auditLog: undefined,
      release: undefined,
    });
    expect(migrated).not.toBeNull();
    const state = migrated!;
    expect(state.version).toBe(2);
    expect(state.revision).toBe(0);
    expect(state.updatedAt).not.toBe("");
    // Legacy route facts survive unchanged.
    const analysis = analyzeRoute(state.recordings, state.sites);
    expect(analysis.placedCount).toBe(
      new Set(state.sites.flatMap((site) => site.recordingIds)).size,
    );
    state.sites.forEach((site) => {
      expect(selectRecordingsForSite(state, site.id).map((r) => r.id)).toEqual(
        site.recordingIds,
      );
    });
    // The migrated document is itself a valid current-schema document.
    expect(migrateWorkspace(state)).toEqual(state);
  });

  it("migrates legacy route damage by repairing references instead of dropping the study", () => {
    const legacy = createSeedStudy();
    const legacySites = legacy.sites as unknown[];
    const firstSite = legacySites[0] as Record<string, unknown>;
    const damaged = {
      ...(legacy as unknown as Record<string, unknown>),
      version: 1,
      sites: [
        {
          ...firstSite,
          recordingIds: ["rec-underpass", "rec-ghost", "rec-underpass"],
        },
        ...legacySites.slice(1),
      ],
    };
    const migrated = migrateWorkspace(damaged);
    expect(migrated).not.toBeNull();
    const repaired = validateReferences(migrated!);
    expect(repaired.sites[0].recordingIds).toEqual(["rec-underpass"]);
  });

  it("does not accept legacy data with unknown schema versions or invalid nested entities", () => {
    const legacy = createSeedStudy() as unknown as Record<string, unknown>;
    expect(migrateWorkspace({ ...legacy, version: 0 })).toBeNull();
    expect(migrateWorkspace({ ...legacy, version: 3 })).toBeNull();
    const badNested = {
      ...legacy,
      version: 1,
      recordings: legacy.recordings && [
        {
          ...(legacy.recordings as unknown[])[0] as Record<string, unknown>,
          signalRole: "not-a-role",
        },
      ],
    };
    expect(migrateWorkspace(badNested)).toBeNull();
  });
});
