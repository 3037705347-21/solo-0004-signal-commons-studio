import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileDown,
  GitMerge,
  History,
  Inbox,
  MonitorSmartphone,
  PencilLine,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import {
  explainStudyChange,
  mergeStudyChange,
} from "../../domain/conflictResolution";
import { formatDate } from "../../domain/formatters";
import type {
  ConflictDraft,
  ConflictRecord,
  ConflictRow,
  ConflictSection,
  MergeChoice,
} from "../../domain/models";
import { useStudy } from "../../state/StudyContext";

const SECTION_TITLES: Record<ConflictSection, string> = {
  recordings: "Signal library",
  sites: "Listening route",
  issues: "Review findings",
  planning: "Project & listening plan",
};

const STATUS_COPY: Record<ConflictRow["status"], { label: string; tone: string }> =
  {
    "ours-only": { label: "Only the late save changed", tone: "ours" },
    "theirs-only": { label: "Only the committed save changed", tone: "theirs" },
    agreed: { label: "Same change on both sides", tone: "agreed" },
    conflict: { label: "Changed differently", tone: "conflict" },
    unchanged: { label: "Unchanged", tone: "agreed" },
  };

function RevisionPreamble({ conflict }: { conflict: ConflictRecord }) {
  const explanation = useMemo(
    () =>
      explainStudyChange(conflict.base, conflict.ours, conflict.theirs),
    [conflict],
  );
  return (
    <div className="conflict-preamble">
      <div className="conflict-stamp">
        <Clock3 size={14} />
        Detected {formatDate(conflict.detectedAt)}
      </div>
      <p className="conflict-command">
        The late save was: <strong>{conflict.commandSummary}</strong>
      </p>
      <div className="conflict-counts">
        <span className="conflict-count ours">
          <PencilLine size={13} /> {explanation.oursOnlyCount} only in the late save
        </span>
        <span className="conflict-count theirs">
          <Users size={13} /> {explanation.theirsOnlyCount} only in the committed save
        </span>
        <span className="conflict-count clash">
          <AlertTriangle size={13} /> {explanation.conflictCount} need a decision
        </span>
      </div>
      <div className="conflict-revisions">
        <Badge tone="neutral">Base revision {conflict.baseRevision}</Badge>
        <span>→</span>
        <Badge tone="warning">Late revision {conflict.oursRevision}</Badge>
        <span>→</span>
        <Badge tone="info">Committed revision {conflict.theirsRevision}</Badge>
      </div>
    </div>
  );
}

function DiffRow({ row }: { row: ConflictRow }) {
  const copy = STATUS_COPY[row.status];
  return (
    <div className={`diff-row diff-${copy.tone}`}>
      <div className="diff-row-main">
        <strong>{row.label}</strong>
        {row.detail && <small>{row.detail}</small>}
      </div>
      <div className="diff-row-sides">
        <span className="diff-side diff-side-ours" title="Late save">
          <MonitorSmartphone size={12} />
          {row.oursValue ?? "—"}
        </span>
        <span className="diff-side diff-side-theirs" title="Committed save">
          <Users size={12} />
          {row.theirsValue ?? "—"}
        </span>
      </div>
      <Badge
        tone={
          row.status === "conflict"
            ? "danger"
            : row.status === "agreed"
              ? "positive"
              : "neutral"
        }
      >
        {copy.label}
      </Badge>
    </div>
  );
}

function ChangeTable({ conflict }: { conflict: ConflictRecord }) {
  const explanation = useMemo(
    () => explainStudyChange(conflict.base, conflict.ours, conflict.theirs),
    [conflict],
  );
  const sections = Object.keys(SECTION_TITLES) as ConflictSection[];
  return (
    <div className="conflict-diff">
      <div className="diff-legend" aria-hidden="true">
        <span className="diff-legend-item">
          <MonitorSmartphone size={12} /> Late save (rev {conflict.oursRevision})
        </span>
        <span className="diff-legend-item">
          <Users size={12} /> Committed save (rev {conflict.theirsRevision})
        </span>
      </div>
      {sections.map((section) => {
        const rows = explanation.rows.filter((row) => row.section === section);
        if (!rows.length) return null;
        return (
          <section className="diff-section" key={section}>
            <div className="eyebrow">{SECTION_TITLES[section]}</div>
            {rows.map((row) => (
              <DiffRow key={row.id} row={row} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function MergePicker({
  conflict,
  choices,
  onChoice,
}: {
  conflict: ConflictRecord;
  choices: Record<string, MergeChoice>;
  onChoice: (rowId: string, choice: MergeChoice) => void;
}) {
  const preview = useMemo(
    () => mergeStudyChange(conflict.base, conflict.ours, conflict.theirs, choices),
    [conflict, choices],
  );
  return (
    <div className="conflict-merge">
      <p className="merge-hint">
        Independent edits are folded in automatically. For each row the two
        saves changed differently, pick which wording to keep.
      </p>
      {preview.report.sections.map((sectionReport) => {
        const rows = preview.rows.filter(
          (row) => row.section === sectionReport.section,
        );
        if (!rows.length) return null;
        return (
          <section className="diff-section" key={sectionReport.section}>
            <div className="eyebrow">
              {sectionReport.label} · {sectionReport.conflictCount} to decide ·{" "}
              {sectionReport.autoCount} automatic
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className={`diff-row merge-row ${
                  row.resolvable ? "merge-decision" : "merge-auto"
                }`}
              >
                <div className="diff-row-main">
                  <strong>{row.label}</strong>
                  {row.detail && <small>{row.detail}</small>}
                  {row.status === "agreed" && (
                    <small className="merge-note">
                      Both tabs made the same edit.
                    </small>
                  )}
                </div>
                {row.resolvable ? (
                  <div
                    className="merge-toggle"
                    role="radiogroup"
                    aria-label={`Choose version for ${row.label}`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={row.choice === "ours"}
                      className={row.choice === "ours" ? "selected" : ""}
                      onClick={() => onChoice(row.id, "ours")}
                    >
                      Late save
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={row.choice === "theirs"}
                      className={row.choice === "theirs" ? "selected" : ""}
                      onClick={() => onChoice(row.id, "theirs")}
                    >
                      Committed
                    </button>
                  </div>
                ) : (
                  <Badge tone={row.status === "ours-only" ? "warning" : "info"}>
                    {row.status === "ours-only"
                      ? "Takes late edit"
                      : row.status === "theirs-only"
                        ? "Takes committed edit"
                        : "Same edit"}
                  </Badge>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ConflictSwitcher({
  conflicts,
  activeId,
  onSelect,
}: {
  conflicts: ConflictRecord[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (conflicts.length < 2) return null;
  return (
    <div className="conflict-switcher">
      {conflicts.map((conflict, index) => (
        <button
          key={conflict.id}
          type="button"
          className={conflict.id === activeId ? "selected" : ""}
          onClick={() => onSelect(conflict.id)}
        >
          Conflict {index + 1} · rev {conflict.baseRevision} →{" "}
          {conflict.theirsRevision}
        </button>
      ))}
    </div>
  );
}

function ConflictDialog({ conflict }: { conflict: ConflictRecord }) {
  const { conflicts, resolveConflict, openConflict, closeConflict } = useStudy();
  const [mode, setMode] = useState<"review" | "merge">("review");
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const choose = (rowId: string, choice: MergeChoice) =>
    setChoices((current) => ({ ...current, [rowId]: choice }));
  return (
    <Modal
      eyebrow="EDITING CONFLICT"
      title="Two tabs changed this study"
      onClose={closeConflict}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<Inbox size={15} />}
            onClick={() => resolveConflict(conflict, "draft")}
          >
            Save my edit as a draft
          </Button>
          <Button
            variant="secondary"
            icon={<Users size={15} />}
            onClick={() => resolveConflict(conflict, "theirs")}
          >
            Keep committed version
          </Button>
          <Button
            variant="secondary"
            icon={<PencilLine size={15} />}
            onClick={() => resolveConflict(conflict, "ours")}
          >
            Keep the late save
          </Button>
          <Button
            variant="primary"
            icon={<GitMerge size={15} />}
            onClick={() => {
              if (mode === "review") {
                setMode("merge");
                return;
              }
              resolveConflict(conflict, "merge", choices);
            }}
          >
            {mode === "review" ? "Review merge" : "Apply merged result"}
          </Button>
        </>
      }
    >
      <ConflictSwitcher
        conflicts={conflicts}
        activeId={conflict.id}
        onSelect={openConflict}
      />
      <RevisionPreamble conflict={conflict} />
      {mode === "review" ? (
        <ChangeTable conflict={conflict} />
      ) : (
        <MergePicker conflict={conflict} choices={choices} onChoice={choose} />
      )}
      <div className="conflict-release-note">
        <AlertTriangle size={14} />
        <span>
          {mode === "review"
            ? "Keeping the late save or merging re-opens a frozen release for another readiness check; keeping the committed save leaves the current release status untouched."
            : "Applying the merge re-opens a frozen release until the merged revision passes a fresh readiness check."}
        </span>
      </div>
    </Modal>
  );
}

function DraftShelf({ onClose }: { onClose: () => void }) {
  const { drafts, resumeDraft, discardDraft } = useStudy();
  return (
    <Modal
      eyebrow="SAVED FOR LATER"
      title="Conflict drafts"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {drafts.length === 0 ? (
        <p className="draft-empty">
          When an edit loses a conflict, “Save my edit as a draft” keeps it here
          so nothing is lost.
        </p>
      ) : (
        <ul className="draft-list">
          {drafts.map((draft: ConflictDraft) => (
            <li key={draft.id} className="draft-row">
              <div className="diff-row-main">
                <strong>{draft.commandSummary}</strong>
                <small>
                  Parked {formatDate(draft.createdAt)} against committed revision{" "}
                  {draft.theirsRevision}
                </small>
              </div>
              <div className="draft-actions">
                <Button
                  variant="secondary"
                  icon={<History size={14} />}
                  onClick={() => {
                    resumeDraft(draft);
                    onClose();
                  }}
                >
                  Resume &amp; compare
                </Button>
                <Button
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label={`Discard draft ${draft.commandSummary}`}
                  onClick={() => discardDraft(draft.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * Global conflict surface: the topbar entry with an unresolved-count badge,
 * the resolver dialog, the draft shelf, and cross-tab resolution notices.
 * Mounted once in the app shell so every page shares one explanation.
 */
export function ConflictCenter() {
  const {
    conflicts,
    drafts,
    activeConflict,
    conflictNotice,
    openConflict,
  } = useStudy();
  const [showDrafts, setShowDrafts] = useState(false);
  const unresolved = conflicts.length;
  return (
    <>
      <div className="conflict-entry">
        {drafts.length > 0 && (
          <Button
            variant="ghost"
            icon={<FileDown size={16} />}
            aria-label={`Open saved conflict drafts (${drafts.length})`}
            onClick={() => setShowDrafts(true)}
          >
            <span className="conflict-entry-label">Drafts</span>
            <Badge tone="neutral">{drafts.length}</Badge>
          </Button>
        )}
        {unresolved > 0 && (
          <button
            type="button"
            className="conflict-alert-button"
            onClick={() => openConflict(activeConflict?.id ?? conflicts[0].id)}
            aria-label={`Resolve ${unresolved} editing conflict${
              unresolved === 1 ? "" : "s"
            }`}
          >
            <AlertTriangle size={16} />
            <span>
              {unresolved === 1 ? "1 editing conflict" : `${unresolved} conflicts`}
            </span>
            <span className="conflict-pulse" aria-hidden="true" />
          </button>
        )}
      </div>
      {activeConflict && <ConflictDialog conflict={activeConflict} />}
      {showDrafts && <DraftShelf onClose={() => setShowDrafts(false)} />}
      {conflictNotice && (
        <div
          key={conflictNotice.at}
          className={`toast ${
            conflictNotice.tone === "conflict-detected"
              ? "toast-warning"
              : "toast-positive"
          } conflict-toast`}
          role="status"
        >
          {conflictNotice.tone === "conflict-resolved" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span>
            {conflictNotice.message}
            {conflicts.length > 0 && (
              <button
                type="button"
                className="conflict-toast-link"
                onClick={() =>
                  openConflict(activeConflict?.id ?? conflicts[0].id)
                }
              >
                Review now
              </button>
            )}
          </span>
        </div>
      )}
    </>
  );
}
