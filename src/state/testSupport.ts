import { analyzeRoute } from "../domain/routeAnalysis";
import { evaluateRelease } from "../domain/releaseRules";
import type { StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";

const READY_STAMP = "2026-09-09T12:00:00.000Z";

/**
 * A deterministic study that passes every release gate:
 * - all clips are placed (all featured clips covered),
 * - all four signal roles represented,
 * - all findings resolved,
 * - sites sized generously so capacity never blocks,
 * - sensitive clips assigned to the quiet site.
 */
export function createReadyStudy(): StudyState {
  const seed = createSeedStudy();
  const ordered = [...seed.sites].sort((left, right) => left.sequence - right.sequence);
  const quietIndex = ordered.findIndex((site) => site.quietSpace);
  const sites = ordered.map((site) => ({
    ...site,
    maxClips: 40,
    maxDurationSeconds: 40 * 600,
    recordingIds: [] as string[],
  }));
  seed.recordings.forEach((recording, index) => {
    const target =
      recording.sensitivity === "sensitive"
        ? sites[quietIndex]
        : sites[index % sites.length];
    target.recordingIds.push(recording.id);
  });

  const issues = seed.issues.map((issue) => ({
    ...issue,
    status: "resolved" as const,
    resolvedAt: READY_STAMP,
    updatedAt: READY_STAMP,
  }));
  const state: StudyState = {
    ...seed,
    revision: 0,
    updatedAt: READY_STAMP,
    sites,
    issues,
    release: null,
    auditLog: [],
  };
  const analysis = analyzeRoute(state.recordings, state.sites);
  const result = evaluateRelease(state, analysis, new Date(READY_STAMP));
  if (!result.ready) {
    throw new Error(
      `ready-study fixture is not releasable: ${result.blockers.join("; ")}`,
    );
  }
  return state;
}
