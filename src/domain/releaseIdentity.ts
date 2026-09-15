import type { StudyState } from "./models";

const FINGERPRINT_PREFIX = "sc-r1";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableStringify(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function releaseFingerprint(state: StudyState): string {
  const projection = {
    project: {
      id: state.project.id,
      title: state.project.title,
      fieldArea: state.project.fieldArea,
      listeningQuestion: state.project.listeningQuestion,
      publicationDate: state.project.publicationDate,
    },
    preferences: state.preferences,
    recordings: state.recordings
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((recording) => ({
        id: recording.id,
        catalogId: recording.catalogId,
        title: recording.title,
        source: recording.source,
        recordedOn: recording.recordedOn,
        format: recording.format,
        location: recording.location,
        summary: recording.summary,
        audioSpec: recording.audioSpec,
        signalRole: recording.signalRole,
        sensitivity: recording.sensitivity,
        transcriptStatus: recording.transcriptStatus,
        consentStatus: recording.consentStatus,
        isFeatured: recording.isFeatured,
        tags: [...recording.tags].sort(),
        color: recording.color,
      })),
    sites: state.sites
      .slice()
      .sort((left, right) =>
        left.sequence === right.sequence
          ? left.id.localeCompare(right.id)
          : left.sequence - right.sequence,
      )
      .map((site) => ({
        id: site.id,
        name: site.name,
        shortLabel: site.shortLabel,
        prompt: site.prompt,
        maxDurationSeconds: site.maxDurationSeconds,
        maxClips: site.maxClips,
        quietSpace: site.quietSpace,
        hasSeating: site.hasSeating,
        color: site.color,
        sequence: site.sequence,
        recordingIds: site.recordingIds,
      })),
    issues: state.issues
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        severity: issue.severity,
        status: issue.status,
        siteId: issue.siteId ?? null,
        recordingId: issue.recordingId ?? null,
        owner: issue.owner,
        resolvedAt: issue.resolvedAt ?? null,
      })),
  };
  return `${FINGERPRINT_PREFIX}-${fnv1a(stableStringify(projection))}`;
}
