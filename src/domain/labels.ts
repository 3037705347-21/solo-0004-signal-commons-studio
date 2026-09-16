import type {
  ConsentGrantStatus,
  ConsentPurpose,
  ConsentStatus,
  IssueSeverity,
  IssueStatus,
  Sensitivity,
  SignalRole,
  TranscriptStatus,
} from "./models";
export const roleDescriptions: Record<SignalRole, string> = {
  arrival: "Opens the listening route.",
  texture: "Reveals a recurring sonic pattern.",
  voice: "Centers a resident or spoken account.",
  departure: "Leaves a question ringing after the route.",
};
export const severityDescriptions: Record<IssueSeverity, string> = {
  note: "A useful observation.",
  warning: "Needs attention before release.",
  critical: "Blocks public release.",
};
export const statusDescriptions: Record<IssueStatus, string> = {
  open: "Not started",
  "in-progress": "Being addressed",
  resolved: "Resolved",
};
export const sensitivityDescriptions: Record<Sensitivity, string> = {
  public: "Public",
  restricted: "Context required",
  sensitive: "Sensitive",
};
export const transcriptDescriptions: Record<TranscriptStatus, string> = {
  missing: "Missing",
  draft: "Draft",
  verified: "Verified",
};
export const consentDescriptions: Record<ConsentStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  restricted: "Restricted scope",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
export const consentPurposeDescriptions: Record<ConsentPurpose, string> = {
  route: "Listening route",
  transcript: "Transcript & captions",
  archive: "Public archive",
};
export const grantStatusDescriptions: Record<ConsentGrantStatus, string> = {
  active: "In force",
  restricted: "Restricted",
  withdrawn: "Withdrawn",
};
export function describeRole(value: SignalRole): string {
  return roleDescriptions[value];
}
export function describeSeverity(value: IssueSeverity): string {
  return severityDescriptions[value];
}
export function describeStatus(value: IssueStatus): string {
  return statusDescriptions[value];
}
export function describeSensitivity(value: Sensitivity): string {
  return sensitivityDescriptions[value];
}
export function describeTranscript(value: TranscriptStatus): string {
  return transcriptDescriptions[value];
}
export function describeConsent(value: ConsentStatus): string {
  return consentDescriptions[value];
}
export function isBlockingSeverity(value: IssueSeverity): boolean {
  return value === "critical";
}
