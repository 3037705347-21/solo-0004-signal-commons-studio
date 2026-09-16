import type {
  ConstraintFinding,
  Recording,
  RouteAnalysis,
  RuleSet,
  SignalRole,
  Site,
  SiteAnalysis,
} from "./models";
import { BASELINE_RULES } from "./rules";

const ROLES: SignalRole[] = ["arrival", "texture", "voice", "departure"];
const clipsFor = (site: Site, recordings: Recording[]) =>
  site.recordingIds
    .map((id) => recordings.find((recording) => recording.id === id))
    .filter((recording): recording is Recording => Boolean(recording));

function sensitiveFinding(
  recording: Recording,
  site: Site,
  rules: RuleSet,
): ConstraintFinding | null {
  if (recording.sensitivity !== "sensitive" || site.quietSpace) return null;
  if (rules.sensitivePolicy === "allow") return null;
  const blocking = rules.sensitivePolicy === "block-placement";
  return {
    id: `quiet-${recording.id}-${site.id}`,
    type: blocking ? "error" : "warning",
    title: blocking
      ? "Sensitive clip blocked from this site"
      : "Sensitive clip needs quiet playback",
    detail: blocking
      ? "Current rules require a quiet-playback site for sensitive clips."
      : "Choose a quiet site or document the playback plan before publishing.",
    siteId: site.id,
    recordingId: recording.id,
  };
}

export function canPlaceRecording(
  recording: Recording,
  site: Site,
  current: Recording[] = [],
  rules: RuleSet = BASELINE_RULES,
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
  const limitSeconds = site.maxDurationSeconds * rules.capacityBlockAt;
  if (nextSeconds > limitSeconds)
    findings.push({
      id: `time-limit-${site.id}`,
      type: "error",
      title: "Listening time exceeded",
      detail: `${Math.ceil(nextSeconds / 60)} minutes would exceed this site’s ${Math.round(limitSeconds / 60)} minute target.`,
      siteId: site.id,
      recordingId: recording.id,
    });
  const sensitivity = sensitiveFinding(recording, site, rules);
  if (sensitivity) findings.push(sensitivity);
  return findings;
}

export function analyzeRoute(
  recordings: Recording[],
  sites: Site[],
  rules: RuleSet = BASELINE_RULES,
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
        .map((clip) => sensitiveFinding(clip, site, rules))
        .filter((finding): finding is ConstraintFinding => Boolean(finding));
      if (clips.length > site.maxClips)
        siteFindings.push({
          id: `clip-limit-${site.id}`,
          type: "error",
          title: "Clip limit exceeded",
          detail: `${clips.length} clips are placed against a limit of ${site.maxClips}.`,
          siteId: site.id,
        });
      if (utilization > rules.capacityBlockAt)
        siteFindings.push({
          id: `duration-${site.id}`,
          type: "error",
          title: "Site target exceeded",
          detail: `${Math.ceil(durationSeconds / 60)} minutes are planned against ${Math.round(site.maxDurationSeconds / 60)} minutes.`,
          siteId: site.id,
        });
      if (
        utilization >= rules.capacityWarnAt &&
        utilization <= rules.capacityBlockAt
      )
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
      type: recording.isFeatured && rules.requireFeaturedPlaced
        ? "error"
        : "notice",
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
