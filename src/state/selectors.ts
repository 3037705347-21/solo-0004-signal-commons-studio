import { analyzeRoute, getUnplacedRecordings } from "../domain/routeAnalysis";
import { issueProgress } from "../domain/releaseRules";
import type {
  Recording,
  QualityIssue,
  StudyState,
  Site,
} from "../domain/models";

export function selectRecordingById(
  state: StudyState,
  id: string,
): Recording | undefined {
  return state.recordings.find((recording) => recording.id === id);
}

export function selectSiteById(
  state: StudyState,
  id: string,
): Site | undefined {
  return state.sites.find((site) => site.id === id);
}

export function selectRecordingSite(
  state: StudyState,
  recordingId: string,
): Site | undefined {
  return state.sites.find((site) => site.recordingIds.includes(recordingId));
}

export function selectRecordingsForSite(
  state: StudyState,
  siteId: string,
): Recording[] {
  const site = selectSiteById(state, siteId);
  if (!site) return [];
  const recordingById = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
  return site.recordingIds
    .map((id) => recordingById.get(id))
    .filter((recording): recording is Recording => Boolean(recording));
}

export function selectIssuesForSite(
  state: StudyState,
  siteId: string,
): QualityIssue[] {
  return state.issues.filter((issue) => issue.siteId === siteId);
}

export function selectWorkspaceSummary(state: StudyState) {
  const analysis = analyzeRoute(state.recordings, state.sites);
  return {
    analysis,
    unplacedRecordings: getUnplacedRecordings(state.recordings, state.sites),
    issueProgress: issueProgress(state.issues),
    openIssues: state.issues.filter((issue) => issue.status !== "resolved"),
    criticalIssues: state.issues.filter(
      (issue) => issue.severity === "critical" && issue.status !== "resolved",
    ),
  };
}
