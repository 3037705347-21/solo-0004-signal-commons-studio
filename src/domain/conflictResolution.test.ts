import { describe, expect, it } from "vitest";
import {
  explainStudyChange,
  mergeStudyChange,
  reconcileResolutionOutcome,
} from "./conflictResolution";
import { createSeedStudy } from "../state/seed";
import { releaseFingerprint } from "./releaseIdentity";
import type {
  ConflictRecord,
  RoutePreferences,
  StudyState,
} from "./models";

function stamped(
  state: StudyState,
  revision: number,
  suffix: string,
): StudyState {
  return {
    ...structuredClone(state),
    revision,
    updatedAt: `2026-09-1${suffix}T10:00:00.000Z`,
    auditLog: [],
  };
}

function makeConflict(
  ours: StudyState,
  theirs: StudyState,
  base: StudyState,
): ConflictRecord {
  return {
    id: "conflict-test",
    detectedAt: "2026-09-12T10:00:00.000Z",
    originId: "tab-a",
    originLabel: "This tab",
    commandSummary: "Updated listener profile",
    baseRevision: base.revision,
    oursRevision: ours.revision,
    theirsRevision: theirs.revision,
    base: structuredClone(base),
    ours: structuredClone(ours),
    theirs: structuredClone(theirs),
  };
}

describe("conflict three-way explanation", () => {
  it("classifies independent edits and true collisions", () => {
    const base = stamped(createSeedStudy(), 3, "0");
    const ours = stamped(base, 4, "1");
    ours.recordings[0] = {
      ...ours.recordings[0],
      title: "Underpass reverb (my edit)",
    };
    const theirs = stamped(base, 4, "2");
    theirs.preferences = { ...theirs.preferences, listenerCount: 12 };

    const explanation = explainStudyChange(base, ours, theirs);
    const rows = Object.fromEntries(explanation.rows.map((row) => [row.id, row]));

    expect(rows["recordings:rec-underpass"].status).toBe("ours-only");
    expect(rows["planning:preferences.listenerCount"].status).toBe(
      "theirs-only",
    );
    expect(explanation.conflictCount).toBe(0);
  });

  it("flags the same field edited to different values as a conflict", () => {
    const base = stamped(createSeedStudy(), 3, "0");
    const ours = stamped(base, 4, "1");
    ours.preferences = { ...ours.preferences, listenerCount: 9 };
    const theirs = stamped(base, 4, "2");
    theirs.preferences = { ...theirs.preferences, listenerCount: 14 };

    const explanation = explainStudyChange(base, ours, theirs);
    expect(
      explanation.rows.find(
        (row) => row.id === "planning:preferences.listenerCount",
      )?.status,
    ).toBe("conflict");
    expect(explanation.conflictCount).toBe(1);
  });

  it("recognizes identical edits made on both sides", () => {
    const base = stamped(createSeedStudy(), 3, "0");
    const prefs: RoutePreferences = { ...base.preferences, listenerCount: 21 };
    const ours = stamped(base, 4, "1");
    ours.preferences = prefs;
    const theirs = stamped(base, 4, "2");
    theirs.preferences = { ...prefs };

    const explanation = explainStudyChange(base, ours, theirs);
    expect(
      explanation.rows.find(
        (row) => row.id === "planning:preferences.listenerCount",
      )?.status,
    ).toBe("agreed");
  });

});

describe("conflict three-way merge", () => {
  it("folds independent edits together and preserves the higher revision line", () => {
    const base = stamped(createSeedStudy(), 5, "0");
    const ours = stamped(base, 6, "1");
    ours.recordings[0] = {
      ...ours.recordings[0],
      summary: "Our independent summary rewrite.",
    };
    const theirs = stamped(base, 7, "2");
    theirs.issues = [
      ...theirs.issues,
      {
        ...theirs.issues[0],
        id: "issue-new",
        title: "Their independent finding",
        status: "open",
        createdAt: "2026-09-12T09:00:00.000Z",
        updatedAt: "2026-09-12T09:00:00.000Z",
      },
    ];

    const result = mergeStudyChange(base, ours, theirs);
    expect(result.merged.recordings[0].summary).toBe(
      "Our independent summary rewrite.",
    );
    expect(result.merged.issues.some((issue) => issue.id === "issue-new")).toBe(
      true,
    );
    expect(result.rows.every((row) => row.status !== "conflict")).toBe(true);
  });

  it("defaults colliding entities to the committed version but honors explicit choices", () => {
    const base = stamped(createSeedStudy(), 5, "0");
    const ours = stamped(base, 6, "1");
    ours.recordings[0] = { ...ours.recordings[0], title: "Our title" };
    const theirs = stamped(base, 7, "2");
    theirs.recordings[0] = { ...theirs.recordings[0], title: "Their title" };

    const defaultMerge = mergeStudyChange(base, ours, theirs);
    expect(defaultMerge.merged.recordings[0].title).toBe("Their title");
    const clashRow = defaultMerge.rows.find(
      (row) => row.id === "recordings:rec-underpass",
    );
    expect(clashRow).toMatchObject({ status: "conflict", choice: "theirs" });

    const chosen = mergeStudyChange(base, ours, theirs, {
      "recordings:rec-underpass": "ours",
    });
    expect(chosen.merged.recordings[0].title).toBe("Our title");
  });

  it("repairs route references when a merge removes a placed clip", () => {
    const base = stamped(createSeedStudy(), 5, "0");
    const placedId = base.sites[0].recordingIds[0];
    const ours = stamped(base, 6, "1");
    ours.recordings = ours.recordings.filter(
      (recording) => recording.id !== placedId,
    );
    const theirs = stamped(base, 7, "2");
    theirs.preferences = { ...theirs.preferences, listenerCount: 11 };

    const result = mergeStudyChange(base, ours, theirs);
    expect(
      result.merged.sites.every((site) =>
        site.recordingIds.every((id) => id !== placedId),
      ),
    ).toBe(true);
  });
});

describe("release explanation after a conflict outcome", () => {
  it("keeps a current release valid when the team keeps the committed version", () => {
    const base = stamped(createSeedStudy(), 2, "0");
    const readyState = stamped(base, 3, "1");
    readyState.release = {
      id: "release-current",
      sequence: 1,
      createdAt: "2026-09-10T10:00:00.000Z",
      status: "ready",
      revision: 3,
      fingerprint: releaseFingerprint(readyState),
      readiness: {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-09-10T10:00:00.000Z",
      },
    };
    readyState.project = { ...readyState.project, stage: "ready" };
    const conflict = makeConflict(base, readyState, readyState);

    const resolved = reconcileResolutionOutcome(conflict.theirs, false);
    expect(resolved.release?.status).toBe("ready");
    expect(resolved.project.stage).toBe("ready");
  });

  it("marks the frozen release stale and regresses to review on keep-mine/merge", () => {
    const base = stamped(createSeedStudy(), 2, "0");
    const theirs = stamped(base, 3, "1");
    theirs.release = {
      id: "release-current",
      sequence: 1,
      createdAt: "2026-09-10T10:00:00.000Z",
      status: "ready",
      revision: 3,
      fingerprint: releaseFingerprint(theirs),
      readiness: {
        ready: true,
        score: 100,
        blockers: [],
        cautions: [],
        checkedAt: "2026-09-10T10:00:00.000Z",
      },
    };
    theirs.project = { ...theirs.project, stage: "ready" };
    const ours = stamped(base, 4, "2");
    ours.recordings[0] = { ...ours.recordings[0], title: "Changed title" };

    const resolved = reconcileResolutionOutcome(
      { ...ours, release: theirs.release },
      true,
    );
    expect(resolved.release?.status).toBe("stale");
    expect(resolved.project.stage).toBe("review");
  });

});
