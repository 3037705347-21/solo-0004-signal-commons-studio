import type { Recording, Site } from "./models";

export interface ListeningPathNode {
  siteId: string;
  siteName: string;
  sequence: number;
  durationSeconds: number;
  recordingCount: number;
  transitions: { from: string; to: string; minutes: number }[];
}

export interface ListeningPathSummary {
  nodes: ListeningPathNode[];
  totalMinutes: number;
  shortestMinutes: number;
  longestMinutes: number;
  transitionCount: number;
}

export function buildListeningPath(
  sites: Site[],
  recordings: Recording[],
): ListeningPathSummary {
  const recordingMap = new Map(
    recordings.map((recording) => [recording.id, recording]),
  );
  const nodes = [...sites]
    .sort((left, right) => left.sequence - right.sequence)
    .map((site, index, all) => {
      const placed = site.recordingIds
        .map((id) => recordingMap.get(id))
        .filter((recording): recording is Recording => Boolean(recording));
      const durationSeconds = placed.reduce(
        (sum, recording) => sum + recording.audioSpec.durationSeconds,
        0,
      );
      const previous = all[index - 1];
      return {
        siteId: site.id,
        siteName: site.name,
        sequence: site.sequence,
        durationSeconds,
        recordingCount: placed.length,
        transitions: previous
          ? [{ from: previous.id, to: site.id, minutes: 1 }]
          : [],
      };
    });
  const totalMinutes =
    nodes.reduce((sum, node) => sum + node.durationSeconds, 0) / 60;
  return {
    nodes,
    totalMinutes,
    shortestMinutes: nodes.length
      ? Math.min(...nodes.map((node) => node.durationSeconds)) / 60
      : 0,
    longestMinutes: nodes.length
      ? Math.max(...nodes.map((node) => node.durationSeconds)) / 60
      : 0,
    transitionCount: Math.max(0, nodes.length - 1),
  };
}

export function getPathProgress(
  path: ListeningPathSummary,
  siteId: string,
): number {
  const index = path.nodes.findIndex((node) => node.siteId === siteId);
  return index < 0 || path.nodes.length < 2
    ? 0
    : index / (path.nodes.length - 1);
}

export function estimateListeningEnd(
  path: ListeningPathSummary,
  start: Date,
  pauseMinutes = 0,
): Date {
  const end = new Date(start);
  end.setMinutes(
    end.getMinutes() +
      path.totalMinutes +
      path.transitionCount +
      Math.max(0, pauseMinutes),
  );
  return end;
}
