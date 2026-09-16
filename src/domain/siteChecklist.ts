import { sortSites } from "./filters";
import { formatMinutes } from "./formatters";
import { consentDescriptions } from "./labels";
import { consentForRecording } from "./consent";
import type {
  ConsentPurpose,
  ConsentStatus,
  IssueSeverity,
  IssueStatus,
  StudyState,
  Site,
} from "./models";

export interface ChecklistFinding {
  severity: IssueSeverity;
  status: IssueStatus;
  title: string;
  owner: string;
  scope: "recording" | "site";
}

export interface SiteChecklistEntry {
  sequence: number;
  recordingId: string;
  catalogId: string;
  title: string;
  durationSeconds: number;
  consentStatus: ConsentStatus;
  consentPurposes: ConsentPurpose[];
  consentGrantedBy: string | null;
  consentEvidenceRef: string | null;
  unresolvedFindings: ChecklistFinding[];
}

export interface SiteChecklist {
  siteId: string;
  siteName: string;
  siteShortLabel: string;
  prompt: string;
  projectTitle: string;
  fieldArea: string;
  generatedAt: string;
  totalDurationSeconds: number;
  clipCount: number;
  unresolvedCount: number;
  siteFindings: ChecklistFinding[];
  entries: SiteChecklistEntry[];
}

export function buildSiteChecklist(
  state: StudyState,
  siteId: string,
  at = new Date(),
): SiteChecklist | null {
  const site = sortSites(state.sites).find(
    (candidate) => candidate.id === siteId,
  );
  if (!site) return null;

  const recordingById = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
  const unresolved = state.issues.filter(
    (issue) => issue.status !== "resolved",
  );

  const toFinding =
    (scope: "recording" | "site") =>
    (issue: {
      severity: IssueSeverity;
      status: IssueStatus;
      title: string;
      owner: string;
    }): ChecklistFinding => ({
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      owner: issue.owner,
      scope,
    });

  const siteFindings: ChecklistFinding[] = unresolved
    .filter((issue) => issue.siteId === site.id && !issue.recordingId)
    .map(toFinding("site"));

  const linkedIssueIds = new Set<string>();
  const entries: SiteChecklistEntry[] = site.recordingIds
    .map((id, index) => {
      const recording = recordingById.get(id);
      if (!recording) return null;
      const decision = consentForRecording(
        recording.id,
        state.consents ?? [],
        at,
      );
      const recordingFindings = unresolved
        .filter((issue) => issue.recordingId === recording.id)
        .map((issue) => {
          linkedIssueIds.add(issue.id);
          return toFinding("recording")(issue);
        });
      return {
        sequence: index + 1,
        recordingId: recording.id,
        catalogId: recording.catalogId,
        title: recording.title,
        durationSeconds: recording.audioSpec.durationSeconds,
        consentStatus: decision.status,
        consentPurposes: decision.purposes,
        consentGrantedBy: decision.grant?.grantedBy ?? null,
        consentEvidenceRef: decision.grant?.evidenceRef ?? null,
        unresolvedFindings: [...recordingFindings, ...siteFindings],
      };
    })
    .filter((entry): entry is SiteChecklistEntry => entry !== null);

  return {
    siteId: site.id,
    siteName: site.name,
    siteShortLabel: site.shortLabel,
    prompt: site.prompt,
    projectTitle: state.project.title,
    fieldArea: state.project.fieldArea,
    generatedAt: at.toISOString(),
    totalDurationSeconds: entries.reduce(
      (total, entry) => total + entry.durationSeconds,
      0,
    ),
    clipCount: entries.length,
    unresolvedCount: siteFindings.length + linkedIssueIds.size,
    siteFindings,
    entries,
  };
}

export function siteChecklistFileName(site: Site, date = new Date()): string {
  const slug = (site.shortLabel || site.name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `signal-commons-route-checklist-${slug}-${date.toISOString().slice(0, 10)}.csv`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function severityTag(severity: IssueSeverity): string {
  if (severity === "critical") return "CRITICAL";
  if (severity === "warning") return "WARNING";
  return "NOTE";
}

function formatFinding(finding: ChecklistFinding): string {
  const scope = finding.scope === "site" ? "[site] " : "";
  return `${scope}[${severityTag(finding.severity)}] ${finding.title} (${finding.owner}, ${finding.status})`;
}

export function serializeSiteChecklistCsv(checklist: SiteChecklist): string {
  const lines: string[] = [
    `Project,${csvCell(checklist.projectTitle)}`,
    `Field area,${csvCell(checklist.fieldArea)}`,
    `Site,${csvCell(checklist.siteName)}`,
    `Listening prompt,${csvCell(checklist.prompt)}`,
    `Generated,${csvCell(checklist.generatedAt)}`,
    "",
    [
      "Sequence",
      "Catalog ID",
      "Clip",
      "duration (sec)",
      "Consent",
      "Consent purposes",
      "Consent evidence",
      "Unresolved findings",
    ]
      .map(csvCell)
      .join(","),
  ];

  for (const entry of checklist.entries) {
    const findings = entry.unresolvedFindings.map(formatFinding).join(" | ");
    lines.push(
      [
        entry.sequence,
        entry.catalogId,
        entry.title,
        entry.durationSeconds,
        consentDescriptions[entry.consentStatus],
        entry.consentPurposes.join(" ") || "none",
        entry.consentEvidenceRef
          ? `${entry.consentGrantedBy ?? ""} · ${entry.consentEvidenceRef}`.trim()
          : "",
        findings,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  lines.push(
    "",
    csvCell(
      `Total duration: ${formatMinutes(checklist.totalDurationSeconds / 60)} | Clips: ${checklist.clipCount} | Unresolved findings: ${checklist.unresolvedCount}`,
    ),
  );

  return lines.join("\r\n");
}
