import type { StudyAction } from "../state/actions";
import type { CommandLogEntry } from "./models";

export function describeAction(action: StudyAction): string {
  switch (action.type) {
    case "recording/upsert":
      return `Saved clip ${action.recording.catalogId}`;
    case "recording/remove":
      return `Removed clip ${action.recordingId}`;
    case "placement/assign":
      return `Placed clip in site ${action.siteId}`;
    case "placement/remove":
      return `Removed clip from route`;
    case "placement/reorder":
      return `Changed clip sequence`;
    case "issue/add":
      return `Created finding ${action.issue.title}`;
    case "issue/transition":
      return `Moved finding to ${action.status}`;
    case "preferences/update":
      return `Updated listener profile`;
    case "project/readiness":
      return action.release.readiness.ready
        ? "Marked project ready"
        : "Returned project to review";
    case "workspace/reset":
      return "Reset workspace to sample plan";
    case "workspace/sync":
      return "Synchronized workspace from another tab";
    case "conflict/resolve":
      return action.mode === "theirs"
        ? `Conflict resolved by keeping the committed version (${action.conflict.commandSummary})`
        : action.mode === "ours"
          ? `Conflict resolved by keeping this tab's edit (${action.conflict.commandSummary})`
          : action.mode === "merge"
            ? `Conflict resolved by merging both edits (${action.conflict.commandSummary})`
            : `Conflict parked as a draft (${action.conflict.commandSummary})`;
  }
}

export function makeLogEntry(
  action: StudyAction,
  id: string,
  revision: number,
  at = new Date(),
  actor: CommandLogEntry["actor"] = "local-user",
  status: CommandLogEntry["status"] = "applied",
): CommandLogEntry {
  return {
    id,
    commandId: action.meta?.commandId ?? id,
    originId: action.meta?.originId ?? "local",
    revision,
    expectedRevision: action.meta?.expectedRevision ?? null,
    status,
    action: action.type,
    summary: describeAction(action),
    timestamp: at.toISOString(),
    actor,
    conflictId:
      action.type === "conflict/resolve" ? action.conflict.id : undefined,
  };
}

export function compactLog(
  entries: CommandLogEntry[],
  limit = 50,
): CommandLogEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = `${entry.action}:${entry.summary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-limit);
}
