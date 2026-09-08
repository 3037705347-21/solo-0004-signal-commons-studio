import type { StudyState } from "../domain/models";

function isStoredStudy(value: unknown): value is StudyState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudyState>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.project) &&
    Array.isArray(candidate.recordings) &&
    Array.isArray(candidate.sites) &&
    Array.isArray(candidate.issues) &&
    Boolean(candidate.preferences)
  );
}

export function migrateWorkspace(value: unknown): StudyState | null {
  return isStoredStudy(value) ? value : null;
}

export function validateReferences(state: StudyState): StudyState {
  const recordingIds = new Set(
    state.recordings.map((recording) => recording.id),
  );
  const siteIds = new Set(state.sites.map((site) => site.id));
  return {
    ...state,
    sites: state.sites.map((site) => ({
      ...site,
      recordingIds: site.recordingIds.filter((id) => recordingIds.has(id)),
    })),
    issues: state.issues.map((issue) => ({
      ...issue,
      siteId:
        issue.siteId && siteIds.has(issue.siteId) ? issue.siteId : undefined,
      recordingId:
        issue.recordingId && recordingIds.has(issue.recordingId)
          ? issue.recordingId
          : undefined,
    })),
  };
}
