import {
  normalizeCatalogId,
} from "./ids";
import {
  recordingFromDraft,
  validateRecordingDraft,
} from "./recordingValidation";
import { canPlaceRecording } from "./routeAnalysis";
import { fnv1aHex } from "./hash";
import type {
  IssueSeverity,
  QualityIssue,
  Recording,
  RecordingDraft,
  Site,
  StudyState,
  ValidationError,
} from "./models";

/* ------------------------------------------------------------------ */
/* Editable row models (what the review screen persists and edits)     */
/* ------------------------------------------------------------------ */

export interface BatchRecordingRow {
  kind: "recording";
  rowId: string;
  draft: RecordingDraft;
  /** Route placement requested alongside this clip, if any. */
  siteRef?: string;
  position?: string;
}

export interface BatchPlacementRow {
  kind: "placement";
  rowId: string;
  catalogId: string;
  siteRef: string;
  position: string;
}

export interface BatchIssueRow {
  kind: "issue";
  rowId: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  owner: string;
  /** Free text resolved against catalog id, site id/name/short label. */
  siteRef: string;
  recordingRef: string;
}

export type BatchRow = BatchRecordingRow | BatchPlacementRow | BatchIssueRow;

export interface BatchSession {
  batchId: string;
  label: string;
  rows: BatchRow[];
}

export interface RowReview {
  errors: ValidationError[];
  warnings: string[];
  /** Rows that match an already-received entity are reported, not errors. */
  duplicateOf?: "recording" | "placement" | "issue";
}

export interface BatchReview {
  rows: RowReview[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  warningCount: number;
}

/* ------------------------------------------------------------------ */
/* Parsing: field batches arrive as JSON from the field team           */
/* ------------------------------------------------------------------ */

interface RawBatch {
  batchId?: unknown;
  label?: unknown;
  recordings?: unknown;
  placements?: unknown;
  issues?: unknown;
}

interface RawRecording {
  catalogId?: unknown;
  title?: unknown;
  source?: unknown;
  recordedOn?: unknown;
  format?: unknown;
  location?: unknown;
  summary?: unknown;
  sampleRate?: unknown;
  channels?: unknown;
  bitDepth?: unknown;
  durationSeconds?: unknown;
  signalRole?: unknown;
  sensitivity?: unknown;
  transcriptStatus?: unknown;
  consentStatus?: unknown;
  isFeatured?: unknown;
  tags?: unknown;
  color?: unknown;
  site?: unknown;
  siteRef?: unknown;
  position?: unknown;
}

interface RawPlacement {
  catalogId?: unknown;
  site?: unknown;
  siteRef?: unknown;
  position?: unknown;
}

interface RawIssue {
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  owner?: unknown;
  site?: unknown;
  siteRef?: unknown;
  recording?: unknown;
  recordingRef?: unknown;
  catalogId?: unknown;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);

const numOrBlank = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
};

let rawRowCounter = 0;
const nextRowId = (kind: BatchRow["kind"]): string => {
  rawRowCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${rawRowCounter}`;
};

function coerceTags(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => str(item).trim()).filter(Boolean).join(", ");
  return str(value);
}

function coerceRecording(raw: RawRecording): BatchRecordingRow {
  return {
    kind: "recording",
    rowId: nextRowId("recording"),
    draft: {
      catalogId: str(raw.catalogId),
      title: str(raw.title),
      source: str(raw.source),
      recordedOn: str(raw.recordedOn),
      format: str(raw.format) || "WAV",
      location: str(raw.location),
      summary: str(raw.summary),
      sampleRate: numOrBlank(raw.sampleRate) || "48000",
      channels: numOrBlank(raw.channels) || "2",
      bitDepth: numOrBlank(raw.bitDepth) || "24",
      durationSeconds: numOrBlank(raw.durationSeconds) || "120",
      signalRole: str(raw.signalRole) as RecordingDraft["signalRole"],
      sensitivity: (str(raw.sensitivity) || "public") as RecordingDraft["sensitivity"],
      transcriptStatus: (str(raw.transcriptStatus) || "missing") as RecordingDraft["transcriptStatus"],
      consentStatus: (str(raw.consentStatus) || "pending") as RecordingDraft["consentStatus"],
      isFeatured: Boolean(raw.isFeatured),
      tags: coerceTags(raw.tags),
      color: str(raw.color) || "#2f7c75",
    },
    siteRef: str(raw.siteRef || raw.site) || undefined,
    position: numOrBlank(raw.position) || undefined,
  };
}

function coercePlacement(raw: RawPlacement): BatchPlacementRow {
  return {
    kind: "placement",
    rowId: nextRowId("placement"),
    catalogId: str(raw.catalogId),
    siteRef: str(raw.siteRef || raw.site),
    position: numOrBlank(raw.position),
  };
}

function coerceIssue(raw: RawIssue): BatchIssueRow {
  return {
    kind: "issue",
    rowId: nextRowId("issue"),
    title: str(raw.title),
    description: str(raw.description),
    severity: (str(raw.severity) || "warning") as IssueSeverity,
    owner: str(raw.owner),
    siteRef: str(raw.siteRef || raw.site),
    recordingRef: str(raw.recordingRef || raw.recording || raw.catalogId),
  };
}

export interface ParseBatchResult {
  session: BatchSession | null;
  errors: string[];
}

/**
 * Parses pasted/loaded field-batch JSON. Structural problems (bad JSON,
 * wrong container shape, non-array sections, empty batch) are reported
 * instead of being smuggled into row validation.
 */
export function parseBatchText(text: string): ParseBatchResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { session: null, errors: ["The batch is not valid JSON. Check the file contents."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      session: null,
      errors: ["The batch must be a JSON object with recordings, placements, or issues."],
    };
  }
  const raw = parsed as RawBatch;
  const rows: BatchRow[] = [];
  const sections: Array<[string, unknown, (item: unknown) => BatchRow]> = [
    ["recordings", raw.recordings, (item) => coerceRecording(item as RawRecording)],
    ["placements", raw.placements, (item) => coercePlacement(item as RawPlacement)],
    ["issues", raw.issues, (item) => coerceIssue(item as RawIssue)],
  ];
  for (const [name, value, coerce] of sections) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push(`“${name}” must be a list.`);
      continue;
    }
    value.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${name}[${index + 1}] must be an object and was skipped.`);
        return;
      }
      rows.push(coerce(item));
    });
  }
  if (!rows.length) {
    errors.push("The batch contains no recordings, placements, or findings to review.");
  }
  return {
    session: rows.length
      ? { batchId: str(raw.batchId), label: str(raw.label), rows }
      : null,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Review: every row checked against current library + batch siblings  */
/* ------------------------------------------------------------------ */

export function findSite(sites: Site[], ref: string): Site | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  return sites.find(
    (site) =>
      site.id.toLowerCase() === needle ||
      site.shortLabel.toLowerCase() === needle ||
      site.name.toLowerCase() === needle,
  );
}

function findRecording(
  recordings: Recording[],
  ref: string,
): Recording | undefined {
  const needle = normalizeCatalogId(ref);
  if (!needle) return undefined;
  return recordings.find(
    (recording) => normalizeCatalogId(recording.catalogId) === needle,
  );
}

export function reviewBatch(session: BatchSession, state: StudyState): BatchReview {
  const rows: RowReview[] = session.rows.map(() => ({ errors: [], warnings: [] }));
  const catalogSeen = new Map<string, number>();
  const issueSeen = new Set<string>();

  /* Catalogs introduced by recording rows are part of the resolvable set. */
  const recordingsById = new Map(
    state.recordings.map((recording) => [recording.id, recording]),
  );
  const introducedCatalogs = new Map<string, Recording>();

  session.rows.forEach((row, index) => {
    if (row.kind !== "recording") return;
    const catalog = normalizeCatalogId(row.draft.catalogId);
    if (!catalog) return;
    if (catalogSeen.has(catalog)) {
      rows[index].errors.push({
        field: "catalogId",
        message: `Catalog ID ${catalog} appears more than once in this batch.`,
      });
      return;
    }
    catalogSeen.set(catalog, index);
    introducedCatalogs.set(catalog, previewRecordingFor(session, row));
  });

  const recordingFor = (catalog: string): Recording | undefined =>
    findRecording(state.recordings, catalog) ??
    introducedCatalogs.get(normalizeCatalogId(catalog));

  /* Planned per-site clip order, seeded with what the route already holds. */
  const planned = new Map<string, Recording[]>();
  state.sites.forEach((site) => {
    planned.set(
      site.id,
      site.recordingIds
        .map((id) => recordingsById.get(id))
        .filter((item): item is Recording => Boolean(item)),
    );
  });
  const plannedPlacementKeys = new Set<string>();
  /** Records which site currently claims a clip, so cross-site duplicates and
      "second position" attempts are surfaced during review. */
  const clipSite = new Map<string, string>();
  state.sites.forEach((site) =>
    site.recordingIds.forEach((recordingId) => {
      plannedPlacementKeys.add(`${recordingId}|${site.id}`);
      clipSite.set(recordingId, site.id);
    }),
  );

  /* First pass: recording rows. */
  session.rows.forEach((row, index) => {
    if (row.kind !== "recording") return;
    const review = rows[index];
    const catalog = normalizeCatalogId(row.draft.catalogId);
    const alreadyInLibrary = findRecording(state.recordings, row.draft.catalogId);
    if (alreadyInLibrary) review.duplicateOf = "recording";
    const validation = validateRecordingDraft(
      row.draft,
      state.recordings,
      alreadyInLibrary?.id,
    );
    review.errors.push(...validation);
    if (row.siteRef?.trim()) {
      const site = findSite(state.sites, row.siteRef);
      if (!site) {
        review.errors.push({
          field: "siteRef",
          message: `No listening site matches “${row.siteRef.trim()}”.`,
        });
      } else {
        const recording = recordingFor(catalog);
        const key = `${recording?.id ?? catalog}|${site.id}`;
        const otherSiteId = recording ? clipSite.get(recording.id) : undefined;
        if (plannedPlacementKeys.has(key)) {
          // Keep an earlier “recording” duplicate marker so the row is
          // counted once; a standalone duplicate position marks itself.
          if (!review.duplicateOf) review.duplicateOf = "placement";
        } else if (recording && otherSiteId && otherSiteId !== site.id) {
          const otherSite = state.sites.find((item) => item.id === otherSiteId);
          review.errors.push({
            field: "siteRef",
            message: `${recording.title} is already placed at ${
              otherSite?.shortLabel ?? "another site"
            }; move it instead of adding a second position.`,
          });
        } else if (recording) {
          const current = planned.get(site.id) ?? [];
          const findings = canPlaceRecording(recording, site, current);
          findings
            .filter((finding) => finding.type === "error")
            .forEach((finding) =>
              review.errors.push({ field: "siteRef", message: finding.detail }),
            );
          findings
            .filter((finding) => finding.type === "warning")
            .forEach((finding) => review.warnings.push(finding.detail));
          if (row.position && (!Number.isFinite(Number(row.position)) || Number(row.position) < 1)) {
            review.errors.push({
              field: "position",
              message: "Route position must be a whole number of 1 or more.",
            });
          }
          if (!findings.some((finding) => finding.type === "error")) {
            insertPlanned(planned, site.id, recording, row.position);
            plannedPlacementKeys.add(key);
            clipSite.set(recording.id, site.id);
          }
        }
      }
    }
  });

  /* Second pass: standalone placement rows. */
  session.rows.forEach((row, index) => {
    if (row.kind !== "placement") return;
    const review = rows[index];
    const catalog = normalizeCatalogId(row.catalogId);
    const recording = recordingFor(row.catalogId);
    if (!catalog) {
      review.errors.push({ field: "catalogId", message: "Catalog ID is required." });
    } else if (!recording) {
      review.errors.push({
        field: "catalogId",
        message: `No clip in the library or in this batch matches ${catalog}.`,
      });
    }
    const site = findSite(state.sites, row.siteRef);
    if (!row.siteRef.trim()) {
      review.errors.push({ field: "siteRef", message: "Choose a listening site." });
    } else if (!site) {
      review.errors.push({
        field: "siteRef",
        message: `No listening site matches “${row.siteRef.trim()}”.`,
      });
    }
    if (row.position && (!Number.isFinite(Number(row.position)) || Number(row.position) < 1)) {
      review.errors.push({
        field: "position",
        message: "Route position must be a whole number of 1 or more.",
      });
    }
    if (recording && site) {
      const key = `${recording.id}|${site.id}`;
      const otherSiteId = clipSite.get(recording.id);
      if (plannedPlacementKeys.has(key)) {
        review.duplicateOf = "placement";
      } else if (otherSiteId && otherSiteId !== site.id) {
        const otherSite = state.sites.find((item) => item.id === otherSiteId);
        review.errors.push({
          field: "siteRef",
          message: `${recording.title} is already placed at ${
            otherSite?.shortLabel ?? "another site"
          }; move it instead of adding a second position.`,
        });
      } else {
        const current = planned.get(site.id) ?? [];
        const findings = canPlaceRecording(recording, site, current);
        findings
          .filter((finding) => finding.type === "error")
          .forEach((finding) =>
            review.errors.push({ field: "siteRef", message: finding.detail }),
          );
        findings
          .filter((finding) => finding.type === "warning")
          .forEach((finding) => review.warnings.push(finding.detail));
        if (!findings.some((finding) => finding.type === "error")) {
          insertPlanned(planned, site.id, recording, row.position);
          plannedPlacementKeys.add(key);
          clipSite.set(recording.id, site.id);
        }
      }
    }
  });

  /* Third pass: issue rows. */
  session.rows.forEach((row, index) => {
    if (row.kind !== "issue") return;
    const review = rows[index];
    if (!row.title.trim())
      review.errors.push({ field: "title", message: "A finding title is required." });
    if (row.description.trim().length < 16)
      review.errors.push({
        field: "description",
        message: "Add at least 16 characters of context.",
      });
    if (!row.owner.trim())
      review.errors.push({ field: "owner", message: "Assign an owner." });
    if (!["note", "warning", "critical"].includes(row.severity)) {
      review.errors.push({
        field: "severity",
        message: "Severity must be note, warning, or critical.",
      });
    }
    const site = row.siteRef.trim() ? findSite(state.sites, row.siteRef) : undefined;
    if (row.siteRef.trim() && !site) {
      review.errors.push({
        field: "siteRef",
        message: `No listening site matches “${row.siteRef.trim()}”.`,
      });
    }
    const recording = row.recordingRef.trim()
      ? recordingFor(row.recordingRef)
      : undefined;
    if (row.recordingRef.trim() && !recording) {
      review.errors.push({
        field: "recordingRef",
        message: `No clip in the library or in this batch matches ${normalizeCatalogId(row.recordingRef)}.`,
      });
    }
    if (row.title.trim() && row.owner.trim()) {
      const key = issueKey(
        row.title,
        row.owner,
        recording?.id ?? "",
        site?.id ?? "",
      );
      if (issueSeen.has(key)) {
        review.errors.push({
          field: "title",
          message: "This finding is listed more than once in the batch.",
        });
      } else {
        issueSeen.add(key);
        const existing = state.issues.some(
          (issue) =>
            issueKey(
              issue.title,
              issue.owner,
              issue.recordingId ?? "",
              issue.siteId ?? "",
            ) === key,
        );
        if (existing) review.duplicateOf = "issue";
      }
    }
  });

  const validCount = rows.filter(
    (review) => review.errors.length === 0 && !review.duplicateOf,
  ).length;
  const duplicateCount = rows.filter((review) => Boolean(review.duplicateOf)).length;
  return {
    rows,
    validCount,
    invalidCount: rows.filter((review) => review.errors.length > 0).length,
    duplicateCount,
    warningCount: rows.reduce((sum, review) => sum + review.warnings.length, 0),
  };
}

function insertPlanned(
  planned: Map<string, Recording[]>,
  siteId: string,
  recording: Recording,
  position: string | undefined,
): void {
  const current = planned.get(siteId) ?? [];
  const without = current.filter((item) => item.id !== recording.id);
  const target =
    position === undefined || position.trim() === ""
      ? without.length
      : Math.max(0, Math.min(Number(position) - 1, without.length));
  without.splice(target, 0, recording);
  planned.set(siteId, without);
}

function issueKey(
  title: string,
  owner: string,
  recordingId: string,
  siteId: string,
): string {
  return `${title.trim().toLowerCase()}|${owner.trim().toLowerCase()}|${recordingId}|${siteId}`;
}

/* ------------------------------------------------------------------ */
/* Deterministic identity + batch fingerprint                          */
/* ------------------------------------------------------------------ */

export function previewRecordingFor(
  session: BatchSession,
  row: BatchRecordingRow,
): Recording {
  const catalog = normalizeCatalogId(row.draft.catalogId);
  const now = "1970-01-01T00:00:00.000Z";
  return recordingFromDraft(row.draft, {
    id: recordingIdForBatch(session, catalog),
    createdAt: now,
    updatedAt: now,
  } as Recording);
}

export function recordingIdForBatch(session: BatchSession, catalog: string): string {
  return `rec-batch-${batchKey(session)}-${normalizeCatalogId(catalog)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

export function issueIdForBatch(
  session: BatchSession,
  row: BatchIssueRow,
  recordingId?: string,
  siteId?: string,
): string {
  const material = `${row.title}|${row.owner}|${recordingId ?? ""}|${siteId ?? ""}`;
  return `issue-batch-${batchKey(session)}-${fnv1aHex(material)}`;
}

function canonicalBatchContent(session: BatchSession): string {
  const stripRowIds = (rows: BatchRow[]): unknown =>
    rows
      .slice()
      .sort((left, right) => left.rowId.localeCompare(right.rowId))
      .map((row) => {
        const { rowId: _rowId, ...rest } = row;
        void _rowId;
        if (row.kind === "recording") {
          return { kind: row.kind, draft: row.draft, siteRef: row.siteRef ?? "", position: row.position ?? "" };
        }
        return { ...rest };
      });
  return JSON.stringify({
    batchId: session.batchId.trim(),
    label: session.label.trim(),
    rows: stripRowIds(session.rows),
  });
}

/** Stable key for a batch: explicit batch id when supplied, else content hash. */
export function batchKey(session: BatchSession): string {
  const explicit = session.batchId.trim();
  if (explicit) return `batch-${fnv1aHex(explicit.toLowerCase())}`;
  return `batch-${fnv1aHex(canonicalBatchContent(session))}`;
}

export function batchLabel(session: BatchSession): string {
  return session.label.trim() || session.batchId.trim() || "Untitled field batch";
}

/* ------------------------------------------------------------------ */
/* Atomic commit preparation (shared by the command layer and reducer)  */
/* ------------------------------------------------------------------ */

export interface BatchCommitResult {
  key: string;
  label: string;
  recordings: Recording[];
  sites: Site[];
  issues: QualityIssue[];
  counts: { recordings: number; placements: number; issues: number; skipped: number };
  catalogIds: string[];
}

/**
 * Resolves a reviewed batch against the current state and computes the
 * resulting collections. Throws if any row still violates a business
 * rule, so callers never produce a half-applied batch. Duplicate rows
 * (already received) are skipped, never doubled.
 */
export function commitBatch(
  session: BatchSession,
  state: StudyState,
  at = new Date(),
): BatchCommitResult {
  const review = reviewBatch(session, state);
  const hardError = review.rows.find((rowReview, index) => {
    const row = session.rows[index];
    // A recording already in the library is skipped, so its draft fields
    // cannot block the batch; its embedded placement is still enforced.
    if (row.kind === "recording" && rowReview.duplicateOf === "recording") {
      return false;
    }
    return rowReview.errors.length > 0;
  });
  if (hardError) throw new Error(hardError.errors[0].message);

  const key = batchKey(session);
  const timestamp = at.toISOString();
  const recordings = [...state.recordings];
  const recordingIndex = new Map(recordings.map((recording, i) => [recording.id, i]));
  const byCatalog = new Map(
    recordings.map((recording) => [normalizeCatalogId(recording.catalogId), recording]),
  );
  const sites = state.sites.map((site) => ({ ...site, recordingIds: [...site.recordingIds] }));
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const issues = [...state.issues];
  const catalogIds: string[] = [];
  const counts = { recordings: 0, placements: 0, issues: 0, skipped: 0 };

  const resolveRecording = (catalog: string): Recording | undefined =>
    byCatalog.get(normalizeCatalogId(catalog));

  // Pass 1: recordings.
  session.rows.forEach((row, index) => {
    if (row.kind !== "recording") return;
    const rowReview = review.rows[index];
    const catalog = normalizeCatalogId(row.draft.catalogId);
    const existing = byCatalog.get(catalog);
    if (existing) {
      counts.skipped += 1;
      return;
    }
    if (rowReview.errors.length) throw new Error(rowReview.errors[0].message);
    const id = recordingIdForBatch(session, catalog);
    const recording = recordingFromDraft(
      { ...row.draft, catalogId: catalog },
      { id, createdAt: timestamp, updatedAt: timestamp } as Recording,
    );
    recordings.push(recording);
    recordingIndex.set(id, recordings.length - 1);
    byCatalog.set(catalog, recording);
    catalogIds.push(catalog);
    counts.recordings += 1;
  });

  const placeOne = (
    catalog: string,
    siteRef: string,
    position: string | undefined,
    rowReview: RowReview,
  ) => {
    const recording = resolveRecording(catalog);
    const site = findSite(state.sites, siteRef);
    if (!recording || !site) {
      throw new Error("A placement in this batch could not be resolved.");
    }
    // Already at this exact site — never duplicate a route position,
    // regardless of how the review row was classified.
    if (site.recordingIds.includes(recording.id)) {
      if (rowReview.duplicateOf === "placement") counts.skipped += 1;
      return;
    }
    if (rowReview.errors.length) throw new Error(rowReview.errors[0].message);
    // A clip may only hold one route position.
    const otherSite = sites.find((candidate) =>
      candidate.id !== site.id && candidate.recordingIds.includes(recording.id),
    );
    if (otherSite) {
      throw new Error(
        `${recording.title} is already placed at ${otherSite.shortLabel}; move it instead of adding a second position.`,
      );
    }
    const target = siteById.get(site.id);
    if (!target) return;
    const without = target.recordingIds.filter((id) => id !== recording.id);
    const at2 =
      position === undefined || position.trim() === ""
        ? without.length
        : Math.max(0, Math.min(Number(position) - 1, without.length));
    without.splice(at2, 0, recording.id);
    target.recordingIds = without;
    counts.placements += 1;
  };

  // Pass 2: embedded placements on recording rows.
  session.rows.forEach((row, index) => {
    if (row.kind !== "recording" || !row.siteRef?.trim()) return;
    placeOne(row.draft.catalogId, row.siteRef, row.position, review.rows[index]);
  });

  // Pass 3: standalone placements.
  session.rows.forEach((row, index) => {
    if (row.kind !== "placement") return;
    placeOne(row.catalogId, row.siteRef, row.position, review.rows[index]);
  });

  // Pass 4: issues.
  session.rows.forEach((row, index) => {
    if (row.kind !== "issue") return;
    const rowReview = review.rows[index];
    if (rowReview.duplicateOf) {
      counts.skipped += 1;
      return;
    }
    if (rowReview.errors.length) throw new Error(rowReview.errors[0].message);
    const linkedSite = row.siteRef.trim()
      ? findSite(state.sites, row.siteRef)
      : undefined;
    const linkedRecording = row.recordingRef.trim()
      ? resolveRecording(row.recordingRef)
      : undefined;
    const issue: QualityIssue = {
      id: issueIdForBatch(session, row, linkedRecording?.id, linkedSite?.id),
      title: row.title.trim(),
      description: row.description.trim(),
      severity: row.severity,
      status: "open",
      owner: row.owner.trim(),
      siteId: linkedSite?.id,
      recordingId: linkedRecording?.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    issues.push(issue);
    counts.issues += 1;
  });

  return {
    key,
    label: batchLabel(session),
    recordings,
    sites,
    issues,
    counts,
    catalogIds,
  };
}
