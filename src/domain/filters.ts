import type {
  IssueSeverity,
  IssueStatus,
  QualityIssue,
  Recording,
  Site,
} from "./models";
export interface LibraryFilter {
  query: string;
  roles: string[];
  sensitivities: string[];
  featuredOnly: boolean;
  minSeconds?: number;
  maxSeconds?: number;
}
export interface IssueFilter {
  statuses: IssueStatus[];
  severities: IssueSeverity[];
  siteId?: string;
  owner?: string;
}
export function filterLibrary(
  recordings: Recording[],
  filter: LibraryFilter,
): Recording[] {
  const query = filter.query.trim().toLowerCase();
  return recordings.filter(
    (recording) =>
      (!query ||
        [
          recording.title,
          recording.source,
          recording.catalogId,
          recording.location,
          recording.summary,
          ...recording.tags,
        ].some((value) => value.toLowerCase().includes(query))) &&
      (!filter.roles.length || filter.roles.includes(recording.signalRole)) &&
      (!filter.sensitivities.length ||
        filter.sensitivities.includes(recording.sensitivity)) &&
      (!filter.featuredOnly || recording.isFeatured) &&
      (filter.minSeconds === undefined ||
        recording.audioSpec.durationSeconds >= filter.minSeconds) &&
      (filter.maxSeconds === undefined ||
        recording.audioSpec.durationSeconds <= filter.maxSeconds),
  );
}
export function filterIssues(
  issues: QualityIssue[],
  filter: IssueFilter,
): QualityIssue[] {
  return issues.filter(
    (issue) =>
      (!filter.statuses.length || filter.statuses.includes(issue.status)) &&
      (!filter.severities.length ||
        filter.severities.includes(issue.severity)) &&
      (!filter.siteId || issue.siteId === filter.siteId) &&
      (!filter.owner || issue.owner === filter.owner),
  );
}
export function sortSites(
  sites: Site[],
  direction: "asc" | "desc" = "asc",
): Site[] {
  return [...sites].sort(
    (a, b) => (a.sequence - b.sequence) * (direction === "asc" ? 1 : -1),
  );
}
export function countPlaced(recording: Recording, sites: Site[]): number {
  return sites.filter((site) => site.recordingIds.includes(recording.id))
    .length;
}
