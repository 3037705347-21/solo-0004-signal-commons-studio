import type {
  QualityIssue,
  Recording,
  RoutePreferences,
  Site,
  StudyState,
} from "../../src/domain/models";
import { STORAGE_KEY } from "../../src/state/persistence";

/**
 * Deterministic workspace factory for chaos drills.
 *
 * Every timestamp, id, and generated value is derived from the sequence index,
 * so two runs of a drill seed byte-identical studies and identical reports.
 * Nothing here reads Math.random, Date.now, or the wall clock.
 */

export const DRILL_EPOCH = "2026-09-01T08:00:00.000Z";
const DRILL_DATE = "2026-08-15";

const ROLES = ["arrival", "texture", "voice", "departure"] as const;
const SENSITIVITIES = ["public", "restricted", "sensitive"] as const;
const LOCATIONS = [
  "Mason Street underpass",
  "Riverside produce market",
  "East Loop platform",
  "North Block courtyard",
  "Canal walk",
  "Clay Lane studios",
  "Route 11 terminus",
  "Juniper Park",
];
const COLORS = [
  "#d7654e",
  "#7c6aa6",
  "#2f7c75",
  "#c7903d",
  "#3f6fa8",
  "#8c9474",
  "#a55f72",
  "#597b8e",
];

function drillStamp(index: number): string {
  // One second per generated entity; keeps ordering stable and human readable.
  const ms = Date.parse(DRILL_EPOCH) + index * 1000;
  return new Date(ms).toISOString();
}

export function makeRecording(index: number): Recording {
  const role = ROLES[index % ROLES.length];
  const catalogId = `SC-DRILL-${String(index + 1).padStart(4, "0")}`;
  return {
    id: `rec-drill-${String(index + 1).padStart(4, "0")}`,
    catalogId,
    title: `Drill signal ${index + 1}`,
    source: `Drill recorder ${index % 6}`,
    recordedOn: DRILL_DATE,
    format: index % 3 === 0 ? "FLAC" : "WAV",
    location: LOCATIONS[index % LOCATIONS.length],
    summary: `Deterministic drill clip number ${index + 1} used to exercise recovery and scale paths.`,
    audioSpec: {
      sampleRate: 48000,
      channels: 2,
      bitDepth: 24,
      durationSeconds: 90 + (index % 12) * 10,
    },
    signalRole: role,
    sensitivity: SENSITIVITIES[index % SENSITIVITIES.length],
    transcriptStatus: "verified",
    consentStatus: "confirmed",
    isFeatured: index < 4,
    tags: [`drill`, role, `batch-${Math.floor(index / 20)}`],
    color: COLORS[index % COLORS.length],
    createdAt: drillStamp(index),
    updatedAt: drillStamp(index),
  };
}

const DRILL_SITES: Array<Pick<Site, "name" | "shortLabel" | "prompt">> = [
  {
    name: "Drill threshold",
    shortLabel: "Threshold",
    prompt: "Drill prompt: what arrives first at the edge of the site?",
  },
  {
    name: "Drill rhythms",
    shortLabel: "Rhythms",
    prompt: "Drill prompt: which repeated textures define the middle?",
  },
  {
    name: "Drill voices",
    shortLabel: "Voices",
    prompt: "Drill prompt: whose voices need the slowest listening?",
  },
  {
    name: "Drill return",
    shortLabel: "Return",
    prompt: "Drill prompt: what should remain audible after the route?",
  },
];

export function makeSites(perSite: number): Site[] {
  return DRILL_SITES.map((template, siteIndex) => ({
    id: `site-drill-${siteIndex + 1}`,
    ...template,
    // Large enough that bulk-placement drills never trip capacity.
    maxDurationSeconds: Math.max(600, perSite * 240 + 600),
    maxClips: perSite + 4,
    quietSpace: false,
    hasSeating: true,
    color: COLORS[siteIndex],
    sequence: siteIndex,
    recordingIds: Array.from({ length: perSite }, (_, clipIndex) => {
      const globalIndex = siteIndex * perSite + clipIndex;
      return `rec-drill-${String(globalIndex + 1).padStart(4, "0")}`;
    }),
  }));
}

export function makeDrillIssues(count: number): QualityIssue[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `issue-drill-${String(index + 1).padStart(3, "0")}`,
    title: `Drill finding ${index + 1}`,
    description: `Deterministic non-blocking finding ${index + 1} used to populate the review desk at scale.`,
    severity: "note",
    status: "open",
    owner: `Drill owner ${index % 5}`,
    createdAt: drillStamp(count + index),
    updatedAt: drillStamp(count + index),
  }));
}

export interface DrillStudyOptions {
  recordingCount?: number;
  placedPerSite?: number;
  issueCount?: number;
  preferences?: Partial<RoutePreferences>;
  revision?: number;
  updatedAt?: string;
}

/**
 * Build a valid v2 study. The first `placedPerSite * 4` recordings are
 * distributed round-robin across the four drill sites; the rest stay in the
 * unplaced queue. Default inputs produce the single known-good baseline.
 */
export function makeDrillStudy(options: DrillStudyOptions = {}): StudyState {
  const recordingCount = options.recordingCount ?? 24;
  const placedPerSite = options.placedPerSite ?? 2;
  const issueCount = options.issueCount ?? 0;
  const recordings = Array.from({ length: recordingCount }, (_, index) =>
    makeRecording(index),
  );
  const sites = makeSites(placedPerSite);
  return {
    version: 2,
    revision: options.revision ?? 1,
    updatedAt:
      options.updatedAt ?? drillStamp(recordingCount + issueCount + 1),
    project: {
      id: "signal-commons-drill",
      title: "Signal Commons Drill Workspace",
      fieldArea: "Drill neighborhoods",
      listeningQuestion:
        "Does the workspace survive interruptions, contention, and scale?",
      publicationDate: "2026-12-01",
      stage: "review",
    },
    recordings,
    sites,
    issues: makeDrillIssues(issueCount),
    preferences: {
      pace: "steady",
      accessPriority: 70,
      listenerCount: 6,
      ...options.preferences,
    },
    auditLog: [],
    release: null,
  };
}

/** FNV-1a 32-bit, matching the checksum used by src/state/persistence.ts. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Wrap a study in the checksummed envelope used by real saves. */
export function makeEnvelope(state: StudyState): string {
  const stateJson = JSON.stringify(state);
  return JSON.stringify({
    storageVersion: 1,
    checksum: fnv1a(stateJson),
    stateJson,
  });
}

/** Raw value with a deliberately wrong checksum over valid JSON. */
export function makeCorruptEnvelope(state: StudyState): string {
  const envelope = JSON.parse(makeEnvelope(state)) as {
    checksum: string;
  };
  envelope.checksum = "deadbeef";
  return JSON.stringify(envelope);
}

/** Truncated write simulation: JSON cut off mid-payload (unparseable). */
export function makeTruncatedEnvelope(state: StudyState): string {
  return makeEnvelope(state).slice(0, Math.floor(makeEnvelope(state).length / 2));
}

export const DRILL_STORAGE_KEY = STORAGE_KEY;
export const DRILL_BACKUP_KEY = "signal-commons.workspace.backup.v1";
export const DRILL_REVIEW_UI_KEY = "signal-commons.review-ui.v1";
