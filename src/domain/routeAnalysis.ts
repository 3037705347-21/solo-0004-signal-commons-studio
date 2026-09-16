import { consentForRecording } from "./consent";
import type {
  ConsentGrant,
  ConstraintFinding,
  Recording,
  RouteAnalysis,
  SignalRole,
  Site,
  SiteAnalysis,
} from "./models";

const ROLES: SignalRole[] = ["arrival", "texture", "voice", "departure"];
const clipsFor = (site: Site, recordings: Recording[]) =>
  site.recordingIds
    .map((id) => recordings.find((recording) => recording.id === id))
    .filter((recording): recording is Recording => Boolean(recording));

function sensitiveFinding(
  recording: Recording,
  site: Site,
): ConstraintFinding | null {
  if (recording.sensitivity !== "sensitive" || site.quietSpace) return null;
  return {
    id: `quiet-${recording.id}-${site.id}`,
    type: "warning",
    title: "Sensitive clip needs quiet playback",
    detail:
      "Choose a quiet site or document the playback plan before publishing.",
    siteId: site.id,
    recordingId: recording.id,
  };
}

/**
 * Consent findings for a clip considered for a site. Withdrawn, expired, or
 * out-of-route-scope consent blocks use; unconfirmed consent is a warning;
 * route consent without archive consent is a non-blocking notice.
 */
function consentFindings(
  recording: Recording,
  site: Site,
  grants: ConsentGrant[] | undefined,
  at: Date,
): ConstraintFinding[] {
  if (!grants) return [];
  const decision = consentForRecording(recording.id, grants, at);
  if (decision.purposes.includes("route")) {
    if (!decision.purposes.includes("archive"))
      return [
        {
          id: `consent-archive-${recording.id}`,
          type: "notice",
          title: "Archive use not cleared",
          detail:
            "Route playback is consented, but public archive release is outside the current scope.",
          recordingId: recording.id,
        },
      ];
    return [];
  }
  if (decision.status === "pending")
    return [
      {
        id: `consent-pending-${recording.id}`,
        type: "warning",
        title: "Consent not confirmed",
        detail: `Confirm ${recording.source}'s consent before relying on this clip.`,
        siteId: site.id,
        recordingId: recording.id,
      },
    ];
  const reason =
    decision.status === "withdrawn"
      ? "Consent was withdrawn; the clip cannot be used for new content."
      : decision.status === "expired"
        ? "Consent has expired and cannot authorize new use."
        : "The current consent scope does not cover listening-route playback.";
  return [
    {
      id: `consent-route-${recording.id}`,
      type: "error",
      title: "Clip lacks usable route consent",
      detail: `${recording.title}: ${reason}`,
      siteId: site.id,
      recordingId: recording.id,
    },
  ];
}

export function canPlaceRecording(
  recording: Recording,
  site: Site,
  current: Recording[] = [],
  grants?: ConsentGrant[],
  at = new Date(),
): ConstraintFinding[] {
  const findings: ConstraintFinding[] = [];
  const nextSeconds =
    current.reduce((sum, item) => sum + item.audioSpec.durationSeconds, 0) +
    recording.audioSpec.durationSeconds;
  if (current.length >= site.maxClips)
    findings.push({
      id: `clip-limit-${site.id}`,
      type: "error",
      title: "Clip limit reached",
      detail: `${site.shortLabel} supports up to ${site.maxClips} clips.`,
      siteId: site.id,
      recordingId: recording.id,
    });
  if (nextSeconds > site.maxDurationSeconds)
    findings.push({
      id: `time-limit-${site.id}`,
      type: "error",
      title: "Listening time exceeded",
      detail: `${Math.ceil(nextSeconds / 60)} minutes would exceed this site’s ${Math.round(site.maxDurationSeconds / 60)} minute target.`,
      siteId: site.id,
      recordingId: recording.id,
    });
  const sensitivity = sensitiveFinding(recording, site);
  if (sensitivity) findings.push(sensitivity);
  findings.push(...consentFindings(recording, site, grants, at));
  return findings;
}

export function analyzeRoute(
  recordings: Recording[],
  sites: Site[],
  grants?: ConsentGrant[],
  at = new Date(),
): RouteAnalysis {
  const findings: ConstraintFinding[] = [];
  const placedIds = new Set<string>();
  const analyses: SiteAnalysis[] = sites
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((site) => {
      const clips = clipsFor(site, recordings);
      clips.forEach((clip) => placedIds.add(clip.id));
      const durationSeconds = clips.reduce(
        (sum, clip) => sum + clip.audioSpec.durationSeconds,
        0,
      );
      const utilization = site.maxDurationSeconds
        ? durationSeconds / site.maxDurationSeconds
        : 0;
      const clipUtilization = site.maxClips ? clips.length / site.maxClips : 0;
      const siteFindings = clips
        .flatMap((clip) => [
          sensitiveFinding(clip, site),
          ...consentFindings(clip, site, grants, at),
        ])
        .filter((finding): finding is ConstraintFinding => Boolean(finding));
      if (clips.length > site.maxClips)
        siteFindings.push({
          id: `clip-limit-${site.id}`,
          type: "error",
          title: "Clip limit exceeded",
          detail: `${clips.length} clips are placed against a limit of ${site.maxClips}.`,
          siteId: site.id,
        });
      if (utilization > 1)
        siteFindings.push({
          id: `duration-${site.id}`,
          type: "error",
          title: "Site target exceeded",
          detail: `${Math.ceil(durationSeconds / 60)} minutes are planned against ${Math.round(site.maxDurationSeconds / 60)} minutes.`,
          siteId: site.id,
        });
      if (utilization >= 0.8 && utilization <= 1)
        siteFindings.push({
          id: `pressure-${site.id}`,
          type: "warning",
          title: "Little listening headroom",
          detail: `${Math.round(utilization * 100)}% of the site target is already committed.`,
          siteId: site.id,
        });
      findings.push(...siteFindings);
      return {
        siteId: site.id,
        durationSeconds,
        utilization,
        clipCount: clips.length,
        clipUtilization,
        roleCoverage: Array.from(new Set(clips.map((clip) => clip.signalRole))),
        findings: siteFindings,
      };
    });
  const unplaced = recordings.filter(
    (recording) => !placedIds.has(recording.id),
  );
  unplaced.forEach((recording) =>
    findings.push({
      id: `unplaced-${recording.id}`,
      type: recording.isFeatured ? "error" : "notice",
      title: recording.isFeatured
        ? "Featured clip is unplaced"
        : "Clip is unplaced",
      detail: `${recording.title} has no listening site yet.`,
      recordingId: recording.id,
    }),
  );
  const placed = recordings.filter((recording) => placedIds.has(recording.id));
  const featured = recordings.filter((recording) => recording.isFeatured);
  const roleCoverage =
    new Set(placed.map((recording) => recording.signalRole)).size /
    ROLES.length;
  const uniqueFindings = Array.from(
    new Map(findings.map((finding) => [finding.id, finding])).values(),
  );
  return {
    totalDurationSeconds: analyses.reduce(
      (sum, site) => sum + site.durationSeconds,
      0,
    ),
    placedCount: placed.length,
    unplacedCount: unplaced.length,
    featuredCoverage: featured.length
      ? featured.filter((recording) => placedIds.has(recording.id)).length /
        featured.length
      : 1,
    roleCoverage,
    sites: analyses,
    findings: uniqueFindings,
    blockingCount: uniqueFindings.filter(
      (finding) => finding.type === "error",
    ).length,
    warningCount: uniqueFindings.filter(
      (finding) => finding.type === "warning",
    ).length,
  };
}

export function getUnplacedRecordings(
  recordings: Recording[],
  sites: Site[],
): Recording[] {
  const placed = new Set(sites.flatMap((site) => site.recordingIds));
  return recordings.filter((recording) => !placed.has(recording.id));
}
