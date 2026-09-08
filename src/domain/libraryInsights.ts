import type { Recording, SignalRole } from "./models";
export interface LibraryFacet {
  label: string;
  value: string;
  count: number;
  color?: string;
}
export interface LibraryInsights {
  total: number;
  featuredCount: number;
  totalSeconds: number;
  averageSeconds: number;
  sources: LibraryFacet[];
  roles: LibraryFacet[];
  sensitivities: LibraryFacet[];
  months: LibraryFacet[];
  tagCloud: LibraryFacet[];
}
function facets(
  values: string[],
  colors?: Map<string, string>,
): LibraryFacet[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      label: value,
      value,
      count,
      color: colors?.get(value),
    }));
}
function month(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Undated"
    : date.toLocaleDateString("en", { month: "short", year: "numeric" });
}
export function summarizeLibrary(recordings: Recording[]): LibraryInsights {
  const colors = new Map<SignalRole, string>([
    ["arrival", "#d7654e"],
    ["texture", "#7c6aa6"],
    ["voice", "#2f7c75"],
    ["departure", "#597b8e"],
  ]);
  const totalSeconds = recordings.reduce(
    (sum, recording) => sum + recording.audioSpec.durationSeconds,
    0,
  );
  return {
    total: recordings.length,
    featuredCount: recordings.filter((recording) => recording.isFeatured)
      .length,
    totalSeconds,
    averageSeconds: recordings.length ? totalSeconds / recordings.length : 0,
    sources: facets(recordings.map((recording) => recording.source)),
    roles: facets(
      recordings.map((recording) => recording.signalRole),
      colors,
    ),
    sensitivities: facets(recordings.map((recording) => recording.sensitivity)),
    months: facets(recordings.map((recording) => month(recording.recordedOn))),
    tagCloud: facets(recordings.flatMap((recording) => recording.tags)),
  };
}
export const searchRecordings = (recordings: Recording[], query: string) =>
  recordings.filter(
    (recording) =>
      !query.trim() ||
      [
        recording.title,
        recording.source,
        recording.catalogId,
        recording.location,
        recording.summary,
        ...recording.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
export function sortRecordings(
  recordings: Recording[],
  sort: "title" | "duration" | "recent" | "role",
): Recording[] {
  return [...recordings].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "duration"
        ? b.audioSpec.durationSeconds - a.audioSpec.durationSeconds
        : sort === "recent"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.signalRole.localeCompare(b.signalRole),
  );
}
