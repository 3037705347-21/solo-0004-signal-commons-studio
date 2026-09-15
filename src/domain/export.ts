import type { Snapshot } from "./models";

export function snapshotFileName(date = new Date()): string {
  return `signal-commons-snapshot-${date.toISOString().slice(0, 10)}.json`;
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function parseSnapshot(raw: string): Snapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<Snapshot>;
    if (
      candidate.schemaVersion !== 2 ||
      typeof candidate.releaseId !== "string" ||
      !Number.isInteger(candidate.releaseSequence) ||
      !candidate.project ||
      !candidate.preferences ||
      !candidate.summary ||
      !Number.isInteger(candidate.revision) ||
      typeof candidate.fingerprint !== "string" ||
      !Array.isArray(candidate.sites) ||
      !Array.isArray(candidate.unresolvedIssues)
    )
      return null;
    return value as Snapshot;
  } catch {
    return null;
  }
}

export function downloadTextFile(
  contents: string,
  fileName: string,
  mimeType = "application/json",
): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
