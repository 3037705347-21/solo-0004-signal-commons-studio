import type { Recording, Site } from "./models";
export interface CapacityProjection {
  siteId: string;
  currentSeconds: number;
  remainingSeconds: number;
  currentClips: number;
  remainingClips: number;
  canFitSeconds: (seconds: number) => boolean;
  canFitClip: () => boolean;
}
export function projectSiteCapacity(
  site: Site,
  recordings: Recording[],
): CapacityProjection {
  const currentSeconds = recordings.reduce(
    (sum, recording) => sum + recording.audioSpec.durationSeconds,
    0,
  );
  return {
    siteId: site.id,
    currentSeconds,
    remainingSeconds: Math.max(0, site.maxDurationSeconds - currentSeconds),
    currentClips: recordings.length,
    remainingClips: Math.max(0, site.maxClips - recordings.length),
    canFitSeconds: (seconds) =>
      currentSeconds + seconds <= site.maxDurationSeconds,
    canFitClip: () => recordings.length < site.maxClips,
  };
}
export function rankSitesForRecording(
  recording: Recording,
  sites: Site[],
  occupancy: Map<string, CapacityProjection>,
): Site[] {
  return [...sites].sort((a, b) => {
    const score = (site: Site) => {
      const capacity = occupancy.get(site.id);
      if (
        !capacity ||
        !capacity.canFitSeconds(recording.audioSpec.durationSeconds) ||
        !capacity.canFitClip()
      )
        return -1e6;
      return (
        capacity.remainingSeconds -
        recording.audioSpec.durationSeconds +
        (recording.sensitivity === "sensitive" && site.quietSpace ? 100 : 0)
      );
    };
    return score(b) - score(a);
  });
}
export const describeCapacity = (capacity: CapacityProjection) =>
  `${Math.round(capacity.remainingSeconds / 60)} minutes and ${capacity.remainingClips} clip slots remain.`;
