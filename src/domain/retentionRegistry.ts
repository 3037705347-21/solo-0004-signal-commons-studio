import type {
  Recording,
  ResolvedReferenceStub,
  Site,
  StudyState,
} from "./models";
import { recordingRetention, siteRetention } from "./retention";

/**
 * Reference resolution registry.
 *
 * Every long-lived citation — route placements, issue links, import manifests,
 * and release snapshots — resolves through these lookups instead of indexing
 * live arrays directly. A cleaned record is never a dangling id: it resolves
 * to an "archived" stub while parked, or a "purged" stub backed by either a
 * tombstone or the frozen copy embedded in a published snapshot.
 */

export interface ResolvedRecording {
  id: string;
  kind: "recording";
  availability: "live" | "archived" | "purged";
  recording?: Recording;
  stub?: ResolvedReferenceStub;
}

export interface ResolvedSite {
  id: string;
  kind: "site";
  availability: "live" | "archived" | "purged";
  site?: Site;
  stub?: ResolvedReferenceStub;
}

function archivedStub(
  id: string,
  kind: "recording" | "site",
  label: string,
): ResolvedReferenceStub {
  return { id, kind, label, availability: "archived" };
}

export function resolveRecording(
  state: StudyState,
  recordingId: string,
): ResolvedRecording | null {
  const live = state.recordings.find((item) => item.id === recordingId);
  if (live) {
    const archived = recordingRetention(live).state === "archived";
    return {
      id: live.id,
      kind: "recording",
      availability: archived ? "archived" : "live",
      recording: archived ? undefined : live,
      stub: archived ? archivedStub(live.id, "recording", live.title) : undefined,
    };
  }
  const tombstone = state.tombstones.find(
    (item) => item.id === recordingId && item.kind === "recording",
  );
  // Published snapshots embed frozen copies of the clips they cited. The
  // snapshot copy resolves with full frozen detail; when a tombstone also
  // exists it is attached so purge reason and lineage remain visible.
  for (const release of releaseRecords(state)) {
    for (const site of release.snapshot?.sites ?? []) {
      const frozen = site.recordings.find((item) => item.id === recordingId);
      if (frozen) {
        return {
          id: frozen.id,
          kind: "recording",
          availability: "purged",
          recording: frozen,
          stub: tombstone
            ? {
                id: tombstone.id,
                kind: "recording" as const,
                label: tombstone.label,
                availability: "purged" as const,
                tombstone,
              }
            : undefined,
        };
      }
    }
  }
  if (tombstone) {
    return {
      id: tombstone.id,
      kind: "recording",
      availability: "purged",
      stub: {
        id: tombstone.id,
        kind: "recording",
        label: tombstone.label,
        availability: "purged",
        tombstone,
      },
    };
  }
  return null;
}

export function resolveSite(state: StudyState, siteId: string): ResolvedSite | null {
  const live = state.sites.find((item) => item.id === siteId);
  if (live) {
    const archived = siteRetention(live).state === "archived";
    return {
      id: live.id,
      kind: "site",
      availability: archived ? "archived" : "live",
      site: archived ? undefined : live,
      stub: archived ? archivedStub(live.id, "site", live.name) : undefined,
    };
  }
  const tombstone = state.tombstones.find(
    (item) => item.id === siteId && item.kind === "site",
  );
  if (tombstone) {
    return {
      id: tombstone.id,
      kind: "site",
      availability: "purged",
      stub: {
        id: tombstone.id,
        kind: "site",
        label: tombstone.label,
        availability: "purged",
        tombstone,
      },
    };
  }
  for (const release of releaseRecords(state)) {
    const frozenSite = release.snapshot?.sites.find((item) => item.id === siteId);
    if (frozenSite) {
      const { recordings: _recordings, ...siteShape } = frozenSite;
      return { id: siteShape.id, kind: "site", availability: "purged", site: siteShape };
    }
  }
  return null;
}

function releaseRecords(state: StudyState) {
  return [...(state.release ? [state.release] : []), ...(state.releaseHistory ?? [])];
}

/** True when the id still resolves to a live (non-archived) recording. */
export function isLiveRecording(state: StudyState, recordingId: string): boolean {
  return resolveRecording(state, recordingId)?.availability === "live";
}

export function isLiveSite(state: StudyState, siteId: string): boolean {
  return resolveSite(state, siteId)?.availability === "live";
}

/**
 * Resolve every id on a site's placement list in order, keeping cleaned
 * references as stubs so the citation chain stays intact.
 */
export function resolveSiteRecordings(
  state: StudyState,
  site: Site,
): ResolvedRecording[] {
  return site.recordingIds
    .map((id) => resolveRecording(state, id))
    .filter((item): item is ResolvedRecording => Boolean(item));
}

/** Release versions (current plus lineage) that still embed a cleaned clip. */
export function releasesReferencingRecording(
  state: StudyState,
  recordingId: string,
): string[] {
  const ids: string[] = [];
  for (const release of releaseRecords(state)) {
    const cited = release.snapshot?.sites.some((site) =>
      site.recordings.some((recording) => recording.id === recordingId),
    );
    if (cited) ids.push(release.id);
  }
  return ids;
}
