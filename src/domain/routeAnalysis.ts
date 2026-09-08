import type {
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

export function canPlaceRecording(
  recording: Recording,
  site: Site,
  current: Recording[] = [],
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
  if (recording.sensitivity === "sensitive" && !site.quietSpace)
    findings.push({
      id: `quiet-${recording.id}-${site.id}`,
      type: "warning",
      title: "Sensitive clip needs quiet playback",
      detail:
        "Choose a quiet site or document the playback plan before publishing.",
      siteId: site.id,
      recordingId: recording.id,
    });
  return findings;
}

export function analyzeRoute(
  recordings: Recording[],
  sites: Site[],
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
      const siteFindings = clips.flatMap((clip, index) =>
        canPlaceRecording(clip, site, clips.slice(0, index)),
      );
      if (utilization > 1)
        siteFindings.push({
          id: `duration-${site.id}`,
          type: "error",
          title: "Site target exceeded",
          detail: `${Math.ceil(durationSeconds / 60)} minutes are planned against ${Math.round(site.maxDurationSeconds / 60)} minutes.`,
          siteId: site.id,
        });
      if (utilization >= 0.85 && utilization <= 1)
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
    findings,
    blockingCount: findings.filter((finding) => finding.type === "error")
      .length,
    warningCount: findings.filter((finding) => finding.type === "warning")
      .length,
  };
}

export function getUnplacedRecordings(
  recordings: Recording[],
  sites: Site[],
): Recording[] {
  const placed = new Set(sites.flatMap((site) => site.recordingIds));
  return recordings.filter((recording) => !placed.has(recording.id));
}
