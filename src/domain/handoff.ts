import type {
  HandoffBaseline,
  HandoffChange,
  HandoffItem,
  HandoffPacket,
  QualityIssue,
  Recording,
  Site,
  StudyState,
} from "./models";
import { createId } from "./ids";

/**
 * A handoff session begins here: everything before this revision/ID set is the
 * shared baseline the outgoing worker inherited. Changes observed against this
 * baseline are what the receiver must confirm.
 */
export function captureBaseline(state: StudyState, at = new Date()): HandoffBaseline {
  return {
    revision: state.revision,
    capturedAt: at.toISOString(),
    recordingIds: state.recordings.map((recording) => recording.id),
    siteSequences: Object.fromEntries(
      state.sites.map((site) => [site.id, [...site.recordingIds]]),
    ),
    issueIds: state.issues.map((issue) => issue.id),
  };
}

function siteNameById(sites: Site[]): (id?: string) => string | undefined {
  const names = new Map(sites.map((site) => [site.id, site.name]));
  return (id?: string) => (id ? names.get(id) : undefined);
}

/**
 * Diff the current study against the session baseline. The audit log supplies
 * intent (which command changed what) while entity comparison catches net
 * additions/removals, so deletions remain visible even after the entity is gone.
 */
export function deriveChanges(
  state: StudyState,
  baseline: HandoffBaseline,
  at = new Date(),
): HandoffChange[] {
  const changes: HandoffChange[] = [];
  const timestamp = at.toISOString();
  const siteName = siteNameById(state.sites);
  const recordingById = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );

  const baselineRecordings = new Set(baseline.recordingIds);
  const currentRecordings = new Set(state.recordings.map((r) => r.id));
  for (const recording of state.recordings) {
    if (!baselineRecordings.has(recording.id)) {
      changes.push({
        id: createId("change"),
        kind: "recording-added",
        summary: `New clip ${recording.catalogId} · ${recording.title}`,
        recordingId: recording.id,
        recordingTitle: recording.title,
        revision: state.revision,
        at: recording.updatedAt,
      });
    } else if (recording.updatedAt > baseline.capturedAt) {
      changes.push({
        id: createId("change"),
        kind: "recording-updated",
        summary: `Edited clip ${recording.catalogId} · ${recording.title}`,
        recordingId: recording.id,
        recordingTitle: recording.title,
        revision: state.revision,
        at: recording.updatedAt,
      });
    }
  }
  for (const removedId of baseline.recordingIds) {
    if (!currentRecordings.has(removedId)) {
      changes.push({
        id: createId("change"),
        kind: "recording-removed",
        summary: `Removed clip ${removedId} from the library`,
        recordingId: removedId,
        revision: state.revision,
        at: timestamp,
      });
    }
  }

  const baselineIssues = new Set(baseline.issueIds);
  const currentIssues = new Set(state.issues.map((issue) => issue.id));
  for (const issue of state.issues) {
    if (!baselineIssues.has(issue.id)) {
      changes.push({
        id: createId("change"),
        kind: "issue-added",
        summary: `New finding · ${issue.title}`,
        issueId: issue.id,
        issueTitle: issue.title,
        siteId: issue.siteId,
        siteName: siteName(issue.siteId),
        revision: state.revision,
        at: issue.createdAt,
      });
    } else if (issue.updatedAt > baseline.capturedAt) {
      changes.push({
        id: createId("change"),
        kind: "issue-updated",
        summary: `${issue.title} moved to ${issue.status.replace("-", " ")}`,
        siteId: issue.siteId,
        siteName: siteName(issue.siteId),
        recordingId: issue.recordingId,
        revision: state.revision,
        at: issue.updatedAt,
      });
    }
  }
  for (const removedId of baseline.issueIds) {
    if (!currentIssues.has(removedId)) {
      changes.push({
        id: createId("change"),
        kind: "issue-removed",
        summary: `Deleted finding ${removedId}`,
        revision: state.revision,
        at: timestamp,
      });
    }
  }

  for (const site of state.sites) {
    const before = baseline.siteSequences[site.id] ?? [];
    const after = site.recordingIds;
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    for (const recordingId of after) {
      if (!beforeSet.has(recordingId)) {
        const recording = recordingById.get(recordingId);
        changes.push({
          id: createId("change"),
          kind: "placement-added",
          summary: `Placed ${recording?.title ?? recordingId} at ${site.name}`,
          recordingId,
          recordingTitle: recording?.title,
          siteId: site.id,
          siteName: site.name,
          revision: state.revision,
          at: timestamp,
        });
      }
    }
    for (const recordingId of before) {
      if (!afterSet.has(recordingId)) {
        const recording = recordingById.get(recordingId);
        changes.push({
          id: createId("change"),
          kind: "placement-removed",
          summary: `Removed ${recording?.title ?? recordingId} from ${site.name}`,
          recordingId,
          recordingTitle: recording?.title,
          siteId: site.id,
          siteName: site.name,
          revision: state.revision,
          at: timestamp,
        });
      }
    }
    const stayed = before.filter((id) => afterSet.has(id));
    const stayedAfter = after.filter((id) => beforeSet.has(id));
    if (
      stayed.length === stayedAfter.length &&
      stayed.some((id, index) => id !== stayedAfter[index])
    ) {
      changes.push({
        id: createId("change"),
        kind: "placement-reordered",
        summary: `Reordered clips at ${site.name}`,
        siteId: site.id,
        siteName: site.name,
        revision: state.revision,
        at: timestamp,
      });
    }
  }

  return changes.sort((left, right) => left.at.localeCompare(right.at));
}

export interface PendingHandoffDraft {
  outgoingName: string;
  outgoingRole: string;
  incomingName: string;
  note: string;
  openItems: HandoffItem[];
}

/**
 * Freeze the offline session into a portable packet. New entities are tagged
 * with the packet id so their origin stays traceable after acceptance. The
 * provenance tag is excluded from the release fingerprint.
 */
export function createHandoffPacket(
  state: StudyState,
  baseline: HandoffBaseline,
  draft: PendingHandoffDraft,
  at = new Date(),
): { packet: HandoffPacket; recordings: Recording[]; issues: QualityIssue[] } {
  const packetId = createId("handoff");
  const timestamp = at.toISOString();
  const knownRecordings = new Set(baseline.recordingIds);
  const knownIssues = new Set(baseline.issueIds);

  const recordings = state.recordings.map((recording) =>
    knownRecordings.has(recording.id) || recording.handoffId
      ? recording
      : { ...recording, handoffId: packetId },
  );
  const issues = state.issues.map((issue) =>
    knownIssues.has(issue.id) || issue.handoffId
      ? issue
      : { ...issue, handoffId: packetId },
  );

  const packet: HandoffPacket = {
    id: packetId,
    sequence: (lastHandoff(state)?.sequence ?? 0) + 1,
    status: "pending",
    outgoingName: draft.outgoingName.trim(),
    outgoingRole: draft.outgoingRole.trim(),
    incomingName: draft.incomingName.trim(),
    note: draft.note.trim(),
    baseline,
    changes: deriveChanges({ ...state, recordings, issues }, baseline, at),
    openItems: draft.openItems.map((item) => ({
      ...item,
      status: "pending" as const,
    })),
    revisionRange: { from: baseline.revision, to: state.revision },
    createdAt: timestamp,
    supersedes: state.handoffs.find((h) => h.status === "accepted")?.id,
  };
  return { packet, recordings, issues };
}

export function lastHandoff(state: StudyState): HandoffPacket | undefined {
  return state.handoffs[state.handoffs.length - 1];
}

export function pendingHandoff(state: StudyState): HandoffPacket | undefined {
  return state.handoffs.find((handoff) => handoff.status === "pending");
}

/** Ids introduced by a packet — quarantined while the packet is pending. */
export function pendingHandoffRecordingIds(packet: HandoffPacket): Set<string> {
  return new Set(
    packet.changes
      .filter(
        (change) =>
          change.kind === "recording-added" && change.recordingId,
      )
      .map((change) => change.recordingId as string),
  );
}

export function pendingHandoffIssueIds(
  state: StudyState,
  packet: HandoffPacket,
): Set<string> {
  return new Set(
    state.issues
      .filter((issue) => issue.handoffId === packet.id)
      .map((issue) => issue.id),
  );
}

export interface HandoffGuard {
  blocked: boolean;
  reason?: string;
}

/** While a packet is pending, transferred content is frozen until the receiver decides. */
export function guardMutation(
  state: StudyState,
  target: { recordingId?: string; siteId?: string },
): HandoffGuard {
  const packet = pendingHandoff(state);
  if (!packet) return { blocked: false };
  if (target.recordingId) {
    const recording = state.recordings.find((r) => r.id === target.recordingId);
    if (recording?.handoffId === packet.id) {
      return {
        blocked: true,
        reason:
          "This clip is inside a pending handoff. The receiver must accept or decline it before it can be changed.",
      };
    }
  }
  if (target.siteId && packet.changes.some((c) => c.siteId === target.siteId)) {
    return {
      blocked: true,
      reason:
        "This site changed during the pending handoff session. Wait for the receiver to accept or decline the packet.",
    };
  }
  return { blocked: false };
}

export function decideHandoff(
  packet: HandoffPacket,
  decision: Extract<HandoffPacket["status"], "accepted" | "declined">,
  receiverName: string,
  receiverNote: string,
  at = new Date(),
): HandoffPacket {
  if (packet.status !== "pending") {
    throw new Error("Only a pending handoff can be accepted or declined.");
  }
  return {
    ...packet,
    status: decision,
    decidedAt: at.toISOString(),
    receiverName: receiverName.trim(),
    receiverNote: receiverNote.trim(),
    openItems: packet.openItems.map((item) => ({
      ...item,
      status: decision === "accepted" ? "accepted" : "declined",
    })),
  };
}

/** Declining a packet removes content that only exists because of that session. */
export function rollbackDeclinedHandoff(
  state: StudyState,
  packet: HandoffPacket,
): StudyState {
  const introducedRecordings = new Set(
    state.recordings
      .filter((recording) => recording.handoffId === packet.id)
      .map((recording) => recording.id),
  );
  const introducedIssues = new Set(
    state.issues
      .filter((issue) => issue.handoffId === packet.id)
      .map((issue) => issue.id),
  );
  const sites = state.sites.map((site) => ({
    ...site,
    recordingIds: site.recordingIds.filter(
      (id) => !introducedRecordings.has(id),
    ),
  }));
  return {
    ...state,
    sites,
    recordings: state.recordings.filter(
      (recording) => !introducedRecordings.has(recording.id),
    ),
    issues: state.issues.filter((issue) => !introducedIssues.has(issue.id)),
  };
}

/** Pending handoff content must never enter release judgment. */
export function releaseHandoffBlockers(state: StudyState): string[] {
  if (state.activeBaseline && !pendingHandoff(state)) {
    return [
      "An offline handoff session is open. Prepare and confirm the handoff before any release decision.",
    ];
  }
  const packet = pendingHandoff(state);
  if (!packet) return [];
  const blockers = [
    `A field handoff (#${packet.sequence}, from ${packet.outgoingName}) is waiting for receiver confirmation. New clips and findings stay out of release decisions until it is accepted or declined.`,
  ];
  const pendingItems = packet.openItems.filter(
    (item) => item.severity === "critical" && item.status === "pending",
  );
  if (pendingItems.length) {
    blockers.push(
      `${pendingItems.length} critical handover item${pendingItems.length === 1 ? "" : "s"} still need receiver sign-off.`,
    );
  }
  return blockers;
}

/**
 * The release view of the study: content introduced by a pending packet is
 * quarantined, so route coverage and findings are judged on inherited scope.
 */
export function effectiveReleaseState(state: StudyState): StudyState {
  const packet = pendingHandoff(state);
  if (!packet) return state;
  const quarantinedRecordings = new Set(
    state.recordings
      .filter((recording) => recording.handoffId === packet.id)
      .map((recording) => recording.id),
  );
  const quarantinedIssues = new Set(
    state.issues
      .filter((issue) => issue.handoffId === packet.id)
      .map((issue) => issue.id),
  );
  if (quarantinedRecordings.size === 0 && quarantinedIssues.size === 0)
    return state;
  return {
    ...state,
    recordings: state.recordings.filter(
      (recording) => !quarantinedRecordings.has(recording.id),
    ),
    sites: state.sites.map((site) => ({
      ...site,
      recordingIds: site.recordingIds.filter(
        (id) => !quarantinedRecordings.has(id),
      ),
    })),
    issues: state.issues.filter((issue) => !quarantinedIssues.has(issue.id)),
  };
}

/** Trace a clip or finding back to the handoff packet that introduced it. */
export function provenanceOf(
  state: StudyState,
  handoffId: string | undefined,
): HandoffPacket | undefined {
  if (!handoffId) return undefined;
  return state.handoffs.find((handoff) => handoff.id === handoffId);
}
