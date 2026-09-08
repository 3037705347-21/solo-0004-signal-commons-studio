import type { StudyAction } from "../state/actions";

export interface CommandLogEntry {
  id: string;
  action: StudyAction["type"];
  summary: string;
  timestamp: string;
  actor: "local-user" | "system";
}

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
      return action.ready
        ? "Marked project ready"
        : "Returned project to review";
    case "workspace/reset":
      return "Reset workspace to sample plan";
  }
}

export function makeLogEntry(
  action: StudyAction,
  id: string,
  at = new Date(),
  actor: CommandLogEntry["actor"] = "local-user",
): CommandLogEntry {
  return {
    id,
    action: action.type,
    summary: describeAction(action),
    timestamp: at.toISOString(),
    actor,
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
