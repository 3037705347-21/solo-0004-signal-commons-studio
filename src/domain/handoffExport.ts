import type { HandoffPacket, StudyState } from "./models";
import { formatDate } from "./formatters";

export const HANDOFF_CHECKLIST_SCHEMA = 1;

export interface PortableHandoff {
  schemaVersion: 1;
  kind: "signal-commons-handoff";
  generatedAt: string;
  studyTitle: string;
  fieldArea: string;
  packet: HandoffPacket;
  totals: {
    changes: number;
    recordings: number;
    placements: number;
    findings: number;
    openItems: number;
  };
}

export function handoffFileName(packet: HandoffPacket, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `signal-commons-handoff-${packet.sequence}-${day}.json`;
}

export function buildPortableHandoff(
  state: StudyState,
  packet: HandoffPacket,
): PortableHandoff {
  return {
    schemaVersion: HANDOFF_CHECKLIST_SCHEMA,
    kind: "signal-commons-handoff",
    generatedAt: new Date().toISOString(),
    studyTitle: state.project.title,
    fieldArea: state.project.fieldArea,
    packet,
    totals: {
      changes: packet.changes.length,
      recordings: packet.changes.filter((change) =>
        change.kind.startsWith("recording-"),
      ).length,
      placements: packet.changes.filter((change) =>
        change.kind.startsWith("placement-"),
      ).length,
      findings: packet.changes.filter((change) =>
        change.kind.startsWith("issue-"),
      ).length,
      openItems: packet.openItems.length,
    },
  };
}

export function serializePortableHandoff(portable: PortableHandoff): string {
  return JSON.stringify(portable, null, 2);
}

export function parsePortableHandoff(raw: string): PortableHandoff | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PortableHandoff>;
    if (
      candidate.kind !== "signal-commons-handoff" ||
      candidate.schemaVersion !== 1 ||
      !candidate.packet ||
      typeof candidate.studyTitle !== "string"
    )
      return null;
    return value as PortableHandoff;
  } catch {
    return null;
  }
}

const CHANGE_LABELS: Record<HandoffPacket["changes"][number]["kind"], string> = {
  "recording-added": "Clip added",
  "recording-updated": "Clip edited",
  "recording-removed": "Clip removed",
  "placement-added": "Placed on route",
  "placement-removed": "Removed from route",
  "placement-reordered": "Route reordered",
  "issue-added": "Finding added",
  "issue-updated": "Finding updated",
  "issue-removed": "Finding removed",
};

/** A human-readable, printable rendering of the same portable checklist. */
export function renderHandoffMarkdown(portable: PortableHandoff): string {
  const { packet } = portable;
  const lines: string[] = [];
  lines.push(`# Field handoff #${packet.sequence} — ${portable.studyTitle}`);
  lines.push("");
  lines.push(`**Field area:** ${portable.fieldArea}`);
  lines.push(
    `**Status:** ${packet.status}${packet.decidedAt ? ` (decided ${formatDate(packet.decidedAt)})` : ""}`,
  );
  lines.push(`**Prepared:** ${formatDate(packet.createdAt)}`);
  lines.push(
    `**Outgoing:** ${packet.outgoingName}${packet.outgoingRole ? ` — ${packet.outgoingRole}` : ""}`,
  );
  lines.push(`**Intended receiver:** ${packet.incomingName || "—"}`);
  lines.push(
    `**Session revisions:** ${packet.revisionRange.from} → ${packet.revisionRange.to}`,
  );
  lines.push("");
  if (packet.note) {
    lines.push(`> ${packet.note}`);
    lines.push("");
  }
  lines.push("## Scope confirmation");
  lines.push("");
  lines.push(
    "- [ ] I have reviewed every change below and accept the scope of this handoff.",
  );
  lines.push("- [ ] Unfinished items have an owner before the next session.");
  lines.push("");
  lines.push("## Changes during the offline session");
  lines.push("");
  if (packet.changes.length === 0) {
    lines.push("_No changes were recorded._");
  } else {
    lines.push("| # | Change | Detail | Site | When |");
    lines.push("| - | ------ | ------ | ---- | ---- |");
    packet.changes.forEach((change, index) => {
      lines.push(
        `| ${index + 1} | ${CHANGE_LABELS[change.kind]} | ${escapeCell(change.summary)} | ${escapeCell(change.siteName ?? "")} | ${formatDate(change.at)} |`,
      );
    });
  }
  lines.push("");
  lines.push("## Unfinished items");
  lines.push("");
  if (packet.openItems.length === 0) {
    lines.push("_No open items were flagged._");
  } else {
    packet.openItems.forEach((item, index) => {
      lines.push(
        `- [ ] **[${item.severity.toUpperCase()}] ${item.title}** — ${item.detail}`,
      );
      void index;
    });
  }
  lines.push("");
  lines.push("## Receiver sign-off");
  lines.push("");
  lines.push("Receiver name: ______________________");
  lines.push("");
  lines.push("Decision:  [ ] Accept scope    [ ] Decline and return");
  lines.push("");
  lines.push("Note: ________________________________________________");
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
