import { Filter, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { RecordingGlyph } from "../../components/RecordingGlyph";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import {
  draftFromRecording,
  emptyRecordingDraft,
} from "../../domain/recordingValidation";
import { titleCase } from "../../domain/formatters";
import type {
  Recording,
  RecordingDraft,
  SignalRole,
  Sensitivity,
} from "../../domain/models";
import { useStudy } from "../../state/StudyContext";

const roleOptions: SignalRole[] = ["arrival", "texture", "voice", "departure"];
const sensitivityOptions: Sensitivity[] = ["public", "restricted", "sensitive"];

export function LibraryPage() {
  const { state, upsertRecording, removeRecording } = useStudy();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sensitivityFilter, setSensitivityFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [editor, setEditor] = useState<{
    draft: RecordingDraft;
    existing?: Recording;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "positive" | "warning";
    message: string;
  } | null>(null);

  const handoffPending = state.handoffs.some(
    (handoff) => handoff.status === "pending",
  );
  const freezeMessage =
    "The handoff checklist is with the receiver. Withdraw it on the Field handoff page before changing clips.";

  const filtered = useMemo(
    () =>
      state.recordings.filter((recording) => {
        const haystack =
          `${recording.title} ${recording.source} ${recording.catalogId} ${recording.tags.join(" ")}`.toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (roleFilter === "all" || recording.signalRole === roleFilter) &&
          (sensitivityFilter === "all" ||
            recording.sensitivity === sensitivityFilter)
        );
      }),
    [state.recordings, query, roleFilter, sensitivityFilter],
  );

  const notify = (tone: "positive" | "warning", message: string) => {
    setFeedback({ tone, message });
    window.setTimeout(() => setFeedback(null), 3600);
  };

  const handleSave = (draft: RecordingDraft, existing?: Recording) => {
    const result = upsertRecording(draft, existing);
    if (!result.ok) {
      if (result.message && !result.errors) notify("warning", result.message);
      return result;
    }
    setEditor(null);
    notify(
      "positive",
      existing ? "Clip details updated." : "Clip added to the library.",
    );
    return result;
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="SIGNAL LIBRARY"
        title="Library"
        description="Shape the cast of clips before you ask them to carry a story."
        actions={
          <Button
            variant="primary"
            icon={<Plus size={17} />}
            disabled={handoffPending}
            title={handoffPending ? freezeMessage : undefined}
            onClick={() => setEditor({ draft: emptyRecordingDraft })}
          >
            Add clip
          </Button>
        }
      />
      <div className="summary-strip">
        <div>
          <span className="eyebrow">LIBRARY CLIPS</span>
          <strong>
            {state.recordings.length}
            <small> clips</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">FEATURED CLIPS</span>
          <strong>
            {
              state.recordings.filter((recording) => recording.isFeatured)
                .length
            }
            <small> flagged</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">ROLES COVERED</span>
          <strong>
            {
              new Set(state.recordings.map((recording) => recording.signalRole))
                .size
            }
            <small> of 4</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">FILTERED VIEW</span>
          <strong>
            {filtered.length}
            <small> showing</small>
          </strong>
        </div>
      </div>
      <section className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search library"
            placeholder="Search title, source, ID, or tag"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <Button
              variant="ghost"
              icon={<X size={15} />}
              aria-label="Clear search"
              onClick={() => setQuery("")}
            />
          )}
        </div>
        <Button
          variant={showFilters ? "primary" : "secondary"}
          icon={<SlidersHorizontal size={16} />}
          onClick={() => setShowFilters((value) => !value)}
        >
          Filters
        </Button>
        <div className="toolbar-count">
          <Filter size={14} /> {filtered.length} results
        </div>
      </section>
      {showFilters && (
        <section className="filter-drawer">
          <SelectField
            label="Signal role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="all">All roles</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {titleCase(role)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Sensitivity"
            value={sensitivityFilter}
            onChange={(event) => setSensitivityFilter(event.target.value)}
          >
            <option value="all">All sensitivities</option>
            {sensitivityOptions.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </SelectField>
          <Button
            variant="ghost"
            onClick={() => {
              setRoleFilter("all");
              setSensitivityFilter("all");
            }}
          >
            Clear filters
          </Button>
        </section>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={23} />}
          title="No matching clips"
          detail="Try a different search or clear the filters."
        />
      ) : (
        <div className="recording-grid">
          {filtered.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              frozen={handoffPending}
              onEdit={() =>
                setEditor({
                  draft: draftFromRecording(recording),
                  existing: recording,
                })
              }
              onRemove={() => {
                if (
                  !window.confirm(`Remove ${recording.title} from the library?`)
                )
                  return;
                const result = removeRecording(recording.id);
                if (!result.ok)
                  notify("warning", result.message ?? "Removal blocked.");
              }}
            />
          ))}
        </div>
      )}
      {feedback && (
        <div
          className={`toast ${feedback.tone === "warning" ? "toast-warning" : "toast-positive"}`}
        >
          {feedback.message}
        </div>
      )}
      {editor && (
        <RecordingEditor
          initial={editor.draft}
          existing={editor.existing}
          onClose={() => setEditor(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function RecordingCard({
  recording,
  frozen,
  onEdit,
  onRemove,
}: {
  recording: Recording;
  frozen: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="recording-card">
      <div className="recording-card-top">
        <RecordingGlyph color={recording.color} size="large" />
        <div className="recording-actions">
          <Button variant="ghost" disabled={frozen} onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" disabled={frozen} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      <div className="recording-id">{recording.catalogId}</div>
      <h3>{recording.title}</h3>
      <p className="recording-source">
        {recording.source} · {recording.recordedOn}
      </p>
      <p className="recording-summary">{recording.summary}</p>
      <div className="tag-row">
        <Badge tone="info">{titleCase(recording.signalRole)}</Badge>
        <Badge
          tone={recording.sensitivity === "sensitive" ? "warning" : "neutral"}
        >
          {titleCase(recording.sensitivity)}
        </Badge>
        {recording.isFeatured && <Badge tone="danger">Featured clip</Badge>}
      </div>
      <div className="recording-card-bottom">
        <span>{recording.format}</span>
        <strong>
          {Math.round(recording.audioSpec.durationSeconds / 60)} min duration
        </strong>
      </div>
    </article>
  );
}

function RecordingEditor({
  initial,
  existing,
  onClose,
  onSave,
}: {
  initial: RecordingDraft;
  existing?: Recording;
  onClose: () => void;
  onSave: (
    draft: RecordingDraft,
    existing?: Recording,
  ) => { ok: boolean; errors?: Record<string, string> };
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof RecordingDraft>(
    key: K,
    value: RecordingDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const result = onSave(draft, existing);
    if (!result.ok) setErrors(result.errors ?? {});
  };
  return (
    <Modal
      eyebrow={existing ? "EDIT CLIP" : "NEW CLIP"}
      title={existing ? "Update clip record" : "Add to library"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {existing ? "Save changes" : "Add clip"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Catalog ID"
          value={draft.catalogId}
          onChange={(event) => update("catalogId", event.target.value)}
          error={errors.catalogId}
          placeholder="SC-2027-001"
        />
        <TextField
          label="Title"
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          error={errors.title}
          placeholder="Clip title"
        />
        <TextField
          label="Recorder / source"
          value={draft.source}
          onChange={(event) => update("source", event.target.value)}
          error={errors.source}
        />
        <TextField
          label="Recording date"
          value={draft.recordedOn}
          onChange={(event) => update("recordedOn", event.target.value)}
        />
        <TextField
          label="File format"
          value={draft.format}
          onChange={(event) => update("format", event.target.value)}
          error={errors.format}
        />
        <TextField
          label="Location"
          value={draft.location}
          onChange={(event) => update("location", event.target.value)}
        />
        <TextField
          label="Sample rate (Hz)"
          type="number"
          min="0"
          step="0.1"
          value={draft.sampleRate}
          onChange={(event) => update("sampleRate", event.target.value)}
          error={errors.sampleRate}
        />
        <TextField
          label="Channels"
          type="number"
          min="0"
          step="0.1"
          value={draft.channels}
          onChange={(event) => update("channels", event.target.value)}
          error={errors.channels}
        />
        <TextField
          label="Bit depth"
          type="number"
          min="0"
          step="0.1"
          value={draft.bitDepth}
          onChange={(event) => update("bitDepth", event.target.value)}
          error={errors.bitDepth}
        />
        <TextField
          label="Duration (sec)"
          type="number"
          min="1"
          max="3600"
          value={draft.durationSeconds}
          onChange={(event) => update("durationSeconds", event.target.value)}
          error={errors.durationSeconds}
        />
        <SelectField
          label="Signal role"
          value={draft.signalRole}
          onChange={(event) =>
            update("signalRole", event.target.value as SignalRole)
          }
        >
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {titleCase(role)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Sensitivity"
          value={draft.sensitivity}
          onChange={(event) =>
            update("sensitivity", event.target.value as Sensitivity)
          }
        >
          {sensitivityOptions.map((option) => (
            <option key={option} value={option}>
              {titleCase(option)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Transcript status"
          value={draft.transcriptStatus}
          onChange={(event) =>
            update(
              "transcriptStatus",
              event.target.value as RecordingDraft["transcriptStatus"],
            )
          }
        >
          <option value="missing">Missing</option>
          <option value="draft">Draft</option>
          <option value="verified">Verified</option>
        </SelectField>
        <SelectField
          label="Consent status"
          value={draft.consentStatus}
          onChange={(event) =>
            update(
              "consentStatus",
              event.target.value as RecordingDraft["consentStatus"],
            )
          }
        >
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="restricted">Restricted</option>
        </SelectField>
        <TextField
          label="Tags"
          value={draft.tags}
          onChange={(event) => update("tags", event.target.value)}
          hint="Comma-separated, up to 8"
        />
        <TextField
          label="Clip summary"
          textarea
          rows={4}
          value={draft.summary}
          onChange={(event) => update("summary", event.target.value)}
          error={errors.summary}
          hint="Describe the listening context and why this clip matters."
        />
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.isFeatured}
            onChange={(event) => update("isFeatured", event.target.checked)}
          />
          <span>
            <strong>Featured clip</strong>
            <small>Must be placed before readiness can pass.</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}
