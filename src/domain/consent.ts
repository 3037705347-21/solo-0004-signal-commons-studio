import { consentPurposeDescriptions } from "./labels";
import type {
  ConsentBasis,
  ConsentGrant,
  ConsentPurpose,
  ConsentStatus,
  Recording,
  Site,
} from "./models";

export const CONSENT_PURPOSES: ConsentPurpose[] = ["route", "transcript", "archive"];

/** Result of resolving the ledger against a point in time. */
export interface ConsentDecision {
  /** Effective standing of the recording's consent. */
  status: ConsentStatus;
  /** Latest governing grant, whether active, restricted, or withdrawn. */
  grant?: ConsentGrant;
  /** Purposes currently authorized. */
  purposes: ConsentPurpose[];
}

/** A grant that has not lapsed at `at`. A bare date covers the whole expiry day. */
export function isGrantInForce(grant: ConsentGrant, at = new Date()): boolean {
  if (grant.status === "withdrawn") return false;
  if (!grant.expiresAt) return true;
  const expires = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expires)) return false;
  // Date-only expiry values parse to UTC midnight; treat them as end-of-day.
  const endOfExpiryDay = /^\d{4}-\d{2}-\d{2}$/.test(grant.expiresAt)
    ? expires + 24 * 60 * 60 * 1000 - 1
    : expires;
  return endOfExpiryDay >= at.getTime();
}

/**
 * The governing grant is the latest decision for the recording. The ledger is
 * append-only, so array order is authoritative: with equal timestamps the last
 * appended decision wins.
 */
export function latestGrantFor(
  recordingId: string,
  grants: ConsentGrant[],
): ConsentGrant | undefined {
  let latest: ConsentGrant | undefined;
  for (const grant of grants) {
    if (grant.recordingId !== recordingId) continue;
    if (!latest) {
      latest = grant;
      continue;
    }
    // Equal timestamps: the later-appended ledger entry governs.
    if (grant.createdAt >= latest.createdAt) latest = grant;
  }
  return latest;
}

function statusFor(grant: ConsentGrant | undefined, at: Date): ConsentStatus {
  if (!grant) return "pending";
  if (grant.status === "withdrawn") return "withdrawn";
  if (!isGrantInForce(grant, at)) return "expired";
  return grant.status === "restricted" ? "restricted" : "confirmed";
}

export function consentForRecording(
  recordingId: string,
  grants: ConsentGrant[],
  at = new Date(),
): ConsentDecision {
  const grant = latestGrantFor(recordingId, grants);
  const status = statusFor(grant, at);
  const usable =
    grant &&
    (grant.status === "active" || grant.status === "restricted") &&
    isGrantInForce(grant, at);
  return {
    status,
    grant,
    purposes: usable ? grant.purposes : [],
  };
}

export function isConsentUsable(
  recordingId: string,
  grants: ConsentGrant[],
  purpose: ConsentPurpose,
  at = new Date(),
): boolean {
  return consentForRecording(recordingId, grants, at).purposes.includes(purpose);
}

/** Human-readable reason a purpose is not currently authorized. */
export function consentBlockReason(
  recording: Recording,
  grants: ConsentGrant[],
  purpose: ConsentPurpose = "route",
  at = new Date(),
): string | null {
  const decision = consentForRecording(recording.id, grants, at);
  if (decision.purposes.includes(purpose)) return null;
  if (decision.status === "pending")
    return `Consent for “${recording.title}” has not been confirmed.`;
  if (decision.status === "withdrawn")
    return `Consent for “${recording.title}” was withdrawn and the clip can no longer be used.`;
  if (decision.status === "expired")
    return `Consent for “${recording.title}” expired and cannot authorize new use.`;
  return `“${recording.title}” consent does not cover ${consentPurposeDescriptions[purpose].toLowerCase()}.`;
}

export function buildConsentBasis(
  recordingId: string,
  grants: ConsentGrant[],
  at = new Date(),
): ConsentBasis | null {
  const decision = consentForRecording(recordingId, grants, at);
  if (!decision.grant) return null;
  const { grant } = decision;
  return {
    grantId: grant.id,
    recordingId,
    status: grant.status,
    purposes: grant.purposes,
    grantedBy: grant.grantedBy,
    channel: grant.channel,
    evidenceRef: grant.evidenceRef,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
    resolvedAt: at.toISOString(),
  };
}

export interface ConsentImpact {
  recordingId: string;
  catalogId: string;
  title: string;
  status: ConsentStatus;
  purposes: ConsentPurpose[];
  grant?: ConsentGrant;
  /** Sites the clip is currently placed in. */
  siteIds: string[];
  placed: boolean;
  /** True when the current ledger would block new route use. */
  blocksRoute: boolean;
  /** True when route use is allowed but public archive is not cleared. */
  archiveGap: boolean;
}

/**
 * Resolve the consent ledger for every recording against its placements so the
 * desk can show which sites, clips, and pending releases a scope change touches.
 */
export function summarizeConsentImpact(
  recordings: Recording[],
  grants: ConsentGrant[],
  sites: Site[],
  at = new Date(),
): ConsentImpact[] {
  const sitesByRecording = new Map<string, Site[]>();
  sites.forEach((site) => {
    site.recordingIds.forEach((id) => {
      const list = sitesByRecording.get(id) ?? [];
      list.push(site);
      sitesByRecording.set(id, list);
    });
  });
  return recordings.map((recording) => {
    const decision = consentForRecording(recording.id, grants, at);
    const linkedSites = sitesByRecording.get(recording.id) ?? [];
    return {
      recordingId: recording.id,
      catalogId: recording.catalogId,
      title: recording.title,
      status: decision.status,
      purposes: decision.purposes,
      grant: decision.grant,
      siteIds: linkedSites.map((site) => site.id),
      placed: linkedSites.length > 0,
      blocksRoute: !decision.purposes.includes("route"),
      archiveGap:
        decision.purposes.includes("route") &&
        !decision.purposes.includes("archive"),
    };
  });
}
