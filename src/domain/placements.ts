import { canPlaceRecording } from "./routeAnalysis";
import type { StudyState } from "./models";

/**
 * Returns the reason a recording cannot be placed in a site, or null when the
 * placement is allowed. Shared by the command planner (pre-validation) and the
 * reducer guard so both reject with the same message.
 */
export function placementBlocker(
  state: StudyState,
  recordingId: string,
  siteId: string,
): string | null {
  const recording = state.recordings.find(
    (candidate) => candidate.id === recordingId,
  );
  if (!recording) {
    return "Cannot place a clip that is not in the library.";
  }
  const targetSite = state.sites.find((site) => site.id === siteId);
  if (!targetSite) {
    return "Cannot place a recording in an unknown site.";
  }
  const recordingById = new Map(
    state.recordings.map((candidate) => [candidate.id, candidate]),
  );
  const currentClips = targetSite.recordingIds
    .filter((id) => id !== recordingId)
    .map((id) => recordingById.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );
  const [blocking] = canPlaceRecording(recording, targetSite, currentClips).filter(
    (finding) => finding.type === "error",
  );
  return blocking ? blocking.detail : null;
}

/**
 * Returns the reason a recording cannot be reordered inside a site, or null.
 * Unknown sites are not an error: the reorder simply leaves state unchanged.
 */
export function reorderBlocker(
  state: StudyState,
  siteId: string,
  recordingId: string,
): string | null {
  const site = state.sites.find((candidate) => candidate.id === siteId);
  if (site && !site.recordingIds.includes(recordingId)) {
    return "The recording is not placed in this site.";
  }
  return null;
}

export function removeRecordingFromSites(
  state: StudyState,
  recordingId: string,
): StudyState {
  return {
    ...state,
    sites: state.sites.map((site) => ({
      ...site,
      recordingIds: site.recordingIds.filter((id) => id !== recordingId),
    })),
  };
}

export function assignRecording(
  state: StudyState,
  recordingId: string,
  siteId: string,
  index?: number,
): StudyState {
  const blocker = placementBlocker(state, recordingId, siteId);
  if (blocker) {
    throw new Error(blocker);
  }
  const removed = removeRecordingFromSites(state, recordingId);
  return {
    ...removed,
    sites: removed.sites.map((site) => {
      if (site.id !== siteId) return site;
      const targetIndex =
        index === undefined
          ? site.recordingIds.length
          : Math.max(0, Math.min(index, site.recordingIds.length));
      const recordingIds = [...site.recordingIds];
      recordingIds.splice(targetIndex, 0, recordingId);
      return { ...site, recordingIds };
    }),
  };
}

export function reorderRecording(
  state: StudyState,
  siteId: string,
  recordingId: string,
  direction: -1 | 1,
): StudyState {
  const blocker = reorderBlocker(state, siteId, recordingId);
  if (blocker) {
    throw new Error(blocker);
  }
  return {
    ...state,
    sites: state.sites.map((site) => {
      if (site.id !== siteId) return site;
      const currentIndex = site.recordingIds.indexOf(recordingId);
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= site.recordingIds.length)
        return site;
      const recordingIds = [...site.recordingIds];
      [recordingIds[currentIndex], recordingIds[targetIndex]] = [
        recordingIds[targetIndex],
        recordingIds[currentIndex],
      ];
      return { ...site, recordingIds };
    }),
  };
}
