import { releaseFingerprint } from "./releaseIdentity";
import { regressReadyProject } from "./transitions";
import type {
  ConflictDraft,
  ConflictRecord,
  ConflictRow,
  ConflictSection,
  MergeChoice,
  MergeConflictRow,
  MergeReport,
  QualityIssue,
  Recording,
  RoutePreferences,
  Site,
  StudyChangeExplanation,
  StudyMergeResult,
  StudyState,
} from "./models";
import { createId } from "./ids";

const SECTION_LABELS: Record<ConflictSection, string> = {
  recordings: "Signal library",
  sites: "Listening route",
  issues: "Review findings",
  planning: "Project & listening plan",
};

const PLANNING_FIELDS: Array<{
  key: string;
  label: string;
  read: (state: StudyState) => string;
}> = [
  {
    key: "project.title",
    label: "Study title",
    read: (state) => state.project.title,
  },
  {
    key: "project.fieldArea",
    label: "Field area",
    read: (state) => state.project.fieldArea,
  },
  {
    key: "project.listeningQuestion",
    label: "Listening question",
    read: (state) => state.project.listeningQuestion,
  },
  {
    key: "project.publicationDate",
    label: "Publication date",
    read: (state) => state.project.publicationDate,
  },
  {
    key: "preferences.pace",
    label: "Listening pace",
    read: (state) => state.preferences.pace,
  },
  {
    key: "preferences.accessPriority",
    label: "Access priority",
    read: (state) => `${state.preferences.accessPriority}%`,
  },
  {
    key: "preferences.listenerCount",
    label: "Listener count",
    read: (state) => String(state.preferences.listenerCount),
  },
];

interface EntityView<T> {
  entity: T;
  id: string;
  label: string;
  detail: string;
}

function recordingView(entity: Recording): EntityView<Recording> {
  return {
    entity,
    id: entity.id,
    label: entity.title,
    detail: `${entity.catalogId} · ${entity.signalRole}`,
  };
}

function siteView(entity: Site): EntityView<Site> {
  return {
    entity,
    id: entity.id,
    label: entity.name,
    detail: `${entity.recordingIds.length} clip${
      entity.recordingIds.length === 1 ? "" : "s"
    } placed`,
  };
}

function issueView(entity: QualityIssue): EntityView<QualityIssue> {
  return {
    entity,
    id: entity.id,
    label: entity.title,
    detail: `${entity.severity} · ${entity.status}`,
  };
}

const ENTITY_VIEWS = {
  recordings: recordingView,
  sites: siteView,
  issues: issueView,
} as const;

function rowStatus(
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): ConflictRow["status"] {
  const oursChanged = ours !== base;
  const theirsChanged = theirs !== base;
  if (oursChanged && theirsChanged)
    return ours === theirs ? "agreed" : "conflict";
  if (oursChanged) return "ours-only";
  if (theirsChanged) return "theirs-only";
  return "unchanged";
}

function entityDigest(
  section: Exclude<ConflictSection, "planning">,
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
): ConflictRow[] {
  const viewOf = ENTITY_VIEWS[section] as unknown as (
    entity: { id: string },
  ) => EntityView<{ id: string }>;
  let triple: [
    Array<{ id: string }>,
    Array<{ id: string }>,
    Array<{ id: string }>,
  ];
  if (section === "recordings")
    triple = [base.recordings, ours.recordings, theirs.recordings];
  else if (section === "sites") triple = [base.sites, ours.sites, theirs.sites];
  else triple = [base.issues, ours.issues, theirs.issues];
  const [baseCollection, oursCollection, theirsCollection] = triple;
  const baseViews = baseCollection.map(viewOf);
  const oursViews = oursCollection.map(viewOf);
  const theirsViews = theirsCollection.map(viewOf);
  const ids = Array.from(
    new Set([
      ...baseViews.map((view) => view.id),
      ...oursViews.map((view) => view.id),
      ...theirsViews.map((view) => view.id),
    ]),
  );
  return ids.flatMap((id) => {
    const baseView = baseViews.find((view) => view.id === id);
    const oursView = oursViews.find((view) => view.id === id);
    const theirsView = theirsViews.find((view) => view.id === id);
    const label =
      oursView?.label ?? theirsView?.label ?? baseView?.label ?? id;
    const detail = oursView?.detail ?? theirsView?.detail ?? baseView?.detail;
    const status = rowStatus(
      baseView ? JSON.stringify(baseView.entity) : undefined,
      oursView ? JSON.stringify(oursView.entity) : undefined,
      theirsView ? JSON.stringify(theirsView.entity) : undefined,
    );
    if (status === "unchanged") return [];
    return [
      {
        id: `${section}:${id}`,
        section,
        label,
        detail,
        status,
        baseValue: baseView ? "In study" : undefined,
        oursValue: oursView ? "In study" : "Removed",
        theirsValue: theirsView ? "In study" : "Removed",
      },
    ];
  });
}

function planningRows(
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
): ConflictRow[] {
  return PLANNING_FIELDS.flatMap((field) => {
    const baseValue = field.read(base);
    const oursValue = field.read(ours);
    const theirsValue = field.read(theirs);
    const status = rowStatus(baseValue, oursValue, theirsValue);
    if (status === "unchanged") return [];
    return [
      {
        id: `planning:${field.key}`,
        section: "planning",
        label: field.label,
        status,
        baseValue,
        oursValue,
        theirsValue,
      },
    ];
  });
}

/**
 * Three-way explanation of a divergent save: each row names what the local
 * editor changed, what the committed tab changed, and whether the two edits
 * touched the same field or entity.
 */
export function explainStudyChange(
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
): StudyChangeExplanation {
  const rows = [
    ...entityDigest("recordings", base, ours, theirs),
    ...entityDigest("sites", base, ours, theirs),
    ...entityDigest("issues", base, ours, theirs),
    ...planningRows(base, ours, theirs),
  ];
  return {
    rows,
    oursOnlyCount: rows.filter((row) => row.status === "ours-only").length,
    theirsOnlyCount: rows.filter((row) => row.status === "theirs-only").length,
    agreedCount: rows.filter((row) => row.status === "agreed").length,
    conflictCount: rows.filter((row) => row.status === "conflict").length,
  };
}

function mergeCollection<T extends { id: string }>(
  section: Exclude<ConflictSection, "planning">,
  base: T[],
  ours: T[],
  theirs: T[],
  choices: Map<string, MergeChoice>,
): { entities: T[]; rows: MergeConflictRow[]; autoCount: number } {
  const describe = ENTITY_VIEWS[section] as unknown as (
    entity: T,
  ) => EntityView<T>;
  const baseViews = base.map(describe);
  const oursViews = ours.map(describe);
  const theirsViews = theirs.map(describe);
  const ids = Array.from(
    new Set([
      ...baseViews.map((view) => view.id),
      ...oursViews.map((view) => view.id),
      ...theirsViews.map((view) => view.id),
    ]),
  );
  const rows: MergeConflictRow[] = [];
  let autoCount = 0;
  const entities = ids.flatMap((id): T[] => {
    const baseView = baseViews.find((view) => view.id === id);
    const oursView = oursViews.find((view) => view.id === id);
    const theirsView = theirsViews.find((view) => view.id === id);
    const oursChanged =
      JSON.stringify(oursView?.entity) !== JSON.stringify(baseView?.entity);
    const theirsChanged =
      JSON.stringify(theirsView?.entity) !== JSON.stringify(baseView?.entity);
    const rowId = `${section}:${id}`;
    const label =
      oursView?.label ?? theirsView?.label ?? baseView?.label ?? id;
    const detail = oursView?.detail ?? theirsView?.detail ?? baseView?.detail;
    if (!oursChanged && !theirsChanged) {
      return baseView ? [baseView.entity] : [];
    }
    if (oursChanged && !theirsChanged) {
      autoCount += 1;
      rows.push({
        id: rowId,
        section,
        label,
        detail,
        status: "ours-only",
        resolvable: false,
        choice: "ours",
        oursValue: oursView ? "Kept my edit" : "Removed",
        theirsValue: "Unchanged",
      });
      return oursView ? [oursView.entity] : [];
    }
    if (!oursChanged && theirsChanged) {
      autoCount += 1;
      rows.push({
        id: rowId,
        section,
        label,
        detail,
        status: "theirs-only",
        resolvable: false,
        choice: "theirs",
        oursValue: "Unchanged",
        theirsValue: theirsView ? "Kept committed edit" : "Removed",
      });
      return theirsView ? [theirsView.entity] : [];
    }
    // Both sides changed this entity identically; collapse the duplicate edit.
    if (JSON.stringify(oursView?.entity) === JSON.stringify(theirsView?.entity)) {
      rows.push({
        id: rowId,
        section,
        label,
        detail,
        status: "agreed",
        resolvable: false,
        choice: "theirs",
        oursValue: "Edited",
        theirsValue: "Same edit",
      });
      return theirsView ? [theirsView.entity] : [];
    }
    const choice = choices.get(rowId) ?? "theirs";
    const chosen = choice === "ours" ? oursView ?? theirsView : theirsView ?? oursView;
    rows.push({
      id: rowId,
      section,
      label,
      detail,
      status: "conflict",
      resolvable: true,
      choice,
      oursValue: oursView ? "Edited" : "Removed",
      theirsValue: theirsView ? "Edited" : "Removed",
    });
    return chosen ? [chosen.entity] : [];
  });
  return { entities, rows, autoCount };
}

function mergePlanning(
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
  choices: Map<string, MergeChoice>,
): {
  project: StudyState["project"];
  preferences: RoutePreferences;
  rows: MergeConflictRow[];
  autoCount: number;
} {
  const rows: MergeConflictRow[] = [];
  let autoCount = 0;
  let project = { ...theirs.project };
  let preferences = { ...theirs.preferences };
  for (const field of PLANNING_FIELDS) {
    const baseValue = field.read(base);
    const oursValue = field.read(ours);
    const theirsValue = field.read(theirs);
    const oursChanged = oursValue !== baseValue;
    const theirsChanged = theirsValue !== baseValue;
    if (!oursChanged && !theirsChanged) continue;
    const rowId = `planning:${field.key}`;
    if (oursChanged && theirsChanged && oursValue !== theirsValue) {
      const choice = choices.get(rowId) ?? "theirs";
      rows.push({
        id: rowId,
        section: "planning",
        label: field.label,
        status: "conflict",
        resolvable: true,
        choice,
        baseValue,
        oursValue,
        theirsValue,
      });
      if (field.key.startsWith("project.")) {
        const projectKey = field.key.split(".")[1] as keyof StudyState["project"];
        project = {
          ...project,
          [projectKey]:
            choice === "ours"
              ? (ours.project[projectKey] as string)
              : (theirs.project[projectKey] as string),
        };
      } else {
        const prefKey = field.key.split(".")[1] as keyof RoutePreferences;
        preferences = {
          ...preferences,
          [prefKey]:
            choice === "ours"
              ? ours.preferences[prefKey]
              : theirs.preferences[prefKey],
        };
      }
      continue;
    }
    autoCount += 1;
    const status = oursChanged
      ? ("ours-only" as const)
      : ("theirs-only" as const);
    rows.push({
      id: rowId,
      section: "planning",
      label: field.label,
      status,
      resolvable: false,
      choice: oursChanged ? "ours" : "theirs",
      baseValue,
      oursValue,
      theirsValue,
    });
    if (field.key.startsWith("project.")) {
      const projectKey = field.key.split(".")[1] as keyof StudyState["project"];
      project = {
        ...project,
        [projectKey]: oursChanged
          ? (ours.project[projectKey] as string)
          : (theirs.project[projectKey] as string),
      };
    } else {
      const prefKey = field.key.split(".")[1] as keyof RoutePreferences;
      preferences = {
        ...preferences,
        [prefKey]: oursChanged
          ? ours.preferences[prefKey]
          : theirs.preferences[prefKey],
      };
    }
  }
  return { project, preferences, rows, autoCount };
}

/**
 * Drop route references to clips that the merge removed, de-duplicating each
 * site's ordering. Mirrors startup reference repair for merged documents.
 */
function repairRouteReferences(state: StudyState): StudyState {
  const recordingIds = new Set(
    state.recordings.map((recording) => recording.id),
  );
  const siteIds = new Set(state.sites.map((site) => site.id));
  const seen = new Set<string>();
  const sites = state.sites.map((site) => ({
    ...site,
    recordingIds: site.recordingIds.filter((id) => {
      if (!recordingIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  }));
  const issues = state.issues.map((issue) => ({
    ...issue,
    siteId: issue.siteId && siteIds.has(issue.siteId) ? issue.siteId : undefined,
    recordingId:
      issue.recordingId && recordingIds.has(issue.recordingId)
        ? issue.recordingId
        : undefined,
  }));
  return { ...state, sites, issues };
}

/**
 * Three-way merge of two concurrent saves. Independent edits fold together;
 * rows both sides edited differently are resolved per `choices` (defaulting to
 * the already-committed version).
 */
export function mergeStudyChange(
  base: StudyState,
  ours: StudyState,
  theirs: StudyState,
  rawChoices?: Record<string, MergeChoice>,
): StudyMergeResult {
  const choices = new Map(Object.entries(rawChoices ?? {}));
  const recordings = mergeCollection(
    "recordings",
    base.recordings,
    ours.recordings,
    theirs.recordings,
    choices,
  );
  const sites = mergeCollection(
    "sites",
    base.sites,
    ours.sites,
    theirs.sites,
    choices,
  );
  const issues = mergeCollection(
    "issues",
    base.issues,
    ours.issues,
    theirs.issues,
    choices,
  );
  const planning = mergePlanning(base, ours, theirs, choices);
  const rows = [...recordings.rows, ...sites.rows, ...issues.rows, ...planning.rows];
  const sections: MergeReport["sections"] = (
    ["recordings", "sites", "issues", "planning"] as ConflictSection[]
  ).map((section) => ({
    section,
    label: SECTION_LABELS[section],
    conflictCount: rows.filter(
      (row) => row.section === section && row.status === "conflict",
    ).length,
    autoCount: rows.filter(
      (row) =>
        row.section === section &&
        row.status !== "conflict" &&
        row.status !== "unchanged",
    ).length,
  }));
  const envelope: StudyState = {
    ...theirs,
    project: planning.project,
    preferences: planning.preferences,
    recordings: recordings.entities,
    sites: sites.entities,
    issues: issues.entities,
  };
  return {
    merged: repairRouteReferences(envelope),
    rows,
    report: { sections },
  };
}

/**
 * After a conflict outcome lands, explain the release state from the final
 * content: content-affecting resolutions regress a "ready" study to review and
 * mark the frozen release stale; pure acknowledgement ("keep theirs") preserves
 * the committed release exactly.
 */
export function reconcileResolutionOutcome(
  state: StudyState,
  contentChangedFromTheirs: boolean,
): StudyState {
  if (!contentChangedFromTheirs) return state;
  const regressed = regressReadyProject(state);
  if (
    regressed.release &&
    regressed.release.status === "ready" &&
    regressed.release.fingerprint !== releaseFingerprint(regressed)
  ) {
    return { ...regressed, release: { ...regressed.release, status: "stale" } };
  }
  return regressed;
}

export function createConflictDraft(
  conflict: ConflictRecord,
  at = new Date(),
): ConflictDraft {
  return {
    id: createId("draft"),
    createdAt: at.toISOString(),
    originId: conflict.originId,
    commandSummary: conflict.commandSummary,
    baseRevision: conflict.baseRevision,
    theirsRevision: conflict.theirsRevision,
    base: conflict.base,
    ours: conflict.ours,
    theirs: conflict.theirs,
  };
}
