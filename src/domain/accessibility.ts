import { isConsentUsable } from "./consent";
import type { ConsentGrant, Recording, Site } from "./models";
export interface AccessAudit {
  totalRequirements: number;
  coveredRequirements: number;
  coverage: number;
  missing: Array<{ recordingId: string; reason: string; siteId?: string }>;
  strengths: string[];
}
export function auditAccessibility(
  recordings: Recording[],
  sites: Site[],
  consents: ConsentGrant[] = [],
): AccessAudit {
  const byRecording = new Map(
    sites.flatMap((site) => site.recordingIds.map((id) => [id, site] as const)),
  );
  const requirements = recordings.filter(
    (recording) =>
      recording.transcriptStatus !== "verified" ||
      !isConsentUsable(recording.id, consents, "route"),
  );
  const missing = requirements.map((recording) => {
    const site = byRecording.get(recording.id);
    const reasons = [
      recording.transcriptStatus !== "verified" ? "verified transcript" : "",
      !isConsentUsable(recording.id, consents, "route")
        ? "confirmed consent"
        : "",
    ].filter(Boolean);
    return {
      recordingId: recording.id,
      reason: reasons.join(" and "),
      siteId: site?.id,
    };
  });
  const strengths = sites
    .filter((site) => site.quietSpace)
    .map((site) => `${site.shortLabel} provides a quiet listening setting.`);
  if (!requirements.length)
    strengths.push("Every clip has verified access metadata.");
  return {
    totalRequirements: requirements.length,
    coveredRequirements: requirements.length - missing.length,
    coverage: requirements.length
      ? (requirements.length - missing.length) / requirements.length
      : 1,
    missing,
    strengths,
  };
}
export function siteSupportsAccess(site: Site, recording: Recording): boolean {
  return recording.sensitivity !== "sensitive" || site.quietSpace;
}
