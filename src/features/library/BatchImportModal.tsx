import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  FileUp,
  ListChecks,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { titleCase } from "../../domain/formatters";
import {
  parseBatchText,
  reviewBatch,
  batchKey,
  type BatchIssueRow,
  type BatchPlacementRow,
  type BatchRecordingRow,
  type BatchRow,
  type BatchSession,
} from "../../domain/batchImport";
import type { IssueSeverity, RecordingDraft, StudyState } from "../../domain/models";
import {
  loadBatchDraft,
  saveBatchDraft,
  type BatchDraftRecord,
} from "../../state/persistence";
import { useStudy } from "../../state/StudyContext";

const TEMPLATE = `{
  "batchId": "field-2026-09-16-east-loop",
  "label": "East loop September sweep",
  "recordings": [
    {
      "catalogId": "SC-26-101",
      "title": "Breakfast cart steam",
      "source": "Lin Qiao",
      "recordedOn": "2026-09-12",
      "format": "WAV",
      "location": "East Loop food stalls",
      "summary": "Steam, orders, and bicycle bells layer over the first commute of the day.",
      "sampleRate": 48000,
      "channels": 2,
      "bitDepth": 24,
      "durationSeconds": 142,
      "signalRole": "arrival",
      "sensitivity": "public",
      "transcriptStatus": "draft",
      "consentStatus": "confirmed",
      "isFeatured": false,
      "tags": ["morning", "food"],
      "site": "Threshold",
      "position": 2
    }
  ],
  "placements": [
    { "catalogId": "SC-26-003", "site": "Rhythms" }
  ],
  "issues": [
    {
      "title": "Verify breakfast cart consent",
      "description": "Confirm the vendor is comfortable with the morning exchange being public.",
      "severity": "critical",
      "owner": "Amina Patel",
      "catalogId": "SC-26-101"
    }
  ]
}`;

export function BatchImportModal({ onClose }: { onClose: () => void }) {
  const { state, importBatch } = useStudy();
  const resumed = useRef<BatchDraftRecord | null>(loadBatchDraft());
  const [step, setStep] = useState<"compose" | "review">(
    resumed.current?.step ?? "compose",
  );
  const [rawText, setRawText] = useState(resumed.current?.rawText ?? "");
  const [session, setSession] = useState<BatchSession | null>(
    resumed.current?.session ?? null,
  );
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"positive" | "warning">(
    "positive",
  );
  const fileInput = useRef<HTMLInputElement>(null);

  /* Persist the in-progress batch independently of workspace state so a
     reopened app still knows where the reviewer left off. */
  useEffect(() => {
    if (step === "compose") {
      if (rawText.trim()) {
        saveBatchDraft({
          savedAt: new Date().toISOString(),
          step,
          rawText,
          session: session ?? undefined,
        });
      }
      return;
    }
    if (session) {
      saveBatchDraft({ savedAt: new Date().toISOString(), step, session });
    }
  }, [session, step, rawText]);

  const review = useMemo(
    () => (session ? reviewBatch(session, state) : null),
    [session, state],
  );

  const reviewable =
    review && review.invalidCount === 0 && review.validCount > 0;

  const handleParse = () => {
    const result = parseBatchText(rawText);
    setParseErrors(result.errors);
    if (result.session) {
      setSession(result.session);
      setStep("review");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setRawText(await file.text());
    setParseErrors([]);
  };

  const updateRow = (rowId: string, patch: Partial<BatchRow>) => {
    setSession((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.rowId === rowId ? ({ ...row, ...patch } as BatchRow) : row,
            ),
          }
        : current,
    );
  };

  const removeRow = (rowId: string) => {
    setSession((current) =>
      current
        ? { ...current, rows: current.rows.filter((row) => row.rowId !== rowId) }
        : current,
    );
  };

  const acceptBatch = () => {
    if (!session) return;
    const result = importBatch(session);
    if (!result.ok) {
      setFeedbackTone("warning");
      setFeedback(result.message ?? "The batch could not be received.");
      return;
    }
    saveBatchDraft(null);
    setFeedbackTone("positive");
    setFeedback(result.message ?? "Batch received.");
    window.setTimeout(onClose, 1400);
  };

  const discardDraft = () => {
    if (!window.confirm("Discard this batch draft? This cannot be undone."))
      return;
    saveBatchDraft(null);
    setSession(null);
    setRawText("");
    setParseErrors([]);
    setStep("compose");
  };

  return (
    <Modal
      eyebrow="FIELD BATCH IMPORT"
      title="Review a returning field batch"
      onClose={onClose}
      footer={
        step === "compose" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<ListChecks size={16} />}
              onClick={handleParse}
            >
              Review batch
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={() => setStep("compose")}>
              Back to source
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={discardDraft}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              icon={<Upload size={16} />}
              disabled={!reviewable}
              onClick={acceptBatch}
            >
              Receive {review?.validCount ?? 0} item
              {review?.validCount === 1 ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      {resumed.current && (
        <div className="batch-resume-note" role="status">
          <RotateCcw size={14} />
          <span>
            Resumed your in-progress batch from {resumed.current.step} (saved{" "}
            {new Date(resumed.current.savedAt).toLocaleString()}).
          </span>
        </div>
      )}
      {feedback && (
        <div className={`toast toast-${feedbackTone === "warning" ? "warning" : "positive"}`}>
          {feedbackTone === "warning" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {feedback}
        </div>
      )}
      {step === "compose" ? (
        <div className="batch-compose">
          <p className="batch-intro">
            Paste the field team’s JSON batch or choose a file. Nothing enters
            the study until you have reviewed every row and chosen to receive
            it.
          </p>
          <div className="batch-compose-actions">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button
              variant="secondary"
              icon={<FileUp size={16} />}
              onClick={() => fileInput.current?.click()}
            >
              Choose JSON file
            </Button>
            <Button
              variant="ghost"
              icon={<FileJson size={15} />}
              onClick={() => setRawText(TEMPLATE)}
            >
              Paste an example
            </Button>
          </div>
          <textarea
            aria-label="Batch JSON contents"
            className="batch-json-input"
            placeholder="Paste batch JSON here…"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            spellCheck={false}
          />
          {parseErrors.length > 0 && (
            <div className="batch-parse-errors" role="alert">
              {parseErrors.map((error) => (
                <div className="batch-error-line" key={error}>
                  <XCircle size={14} /> {error}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        session &&
        review && (
          <BatchReview
            state={state}
            session={session}
            review={review}
            onUpdateRow={updateRow}
            onRemoveRow={removeRow}
          />
        )
      )}
    </Modal>
  );
}

function BatchReview({
  state,
  session,
  review,
  onUpdateRow,
  onRemoveRow,
}: {
  state: StudyState;
  session: BatchSession;
  review: ReturnType<typeof reviewBatch>;
  onUpdateRow: (rowId: string, patch: Partial<BatchRow>) => void;
  onRemoveRow: (rowId: string) => void;
}) {
  const alreadyReceived = state.imports?.some(
    (receipt) => receipt.batchKey === batchKey(session),
  );
  return (
    <div className="batch-review">
      <div className="batch-review-summary">
        <div>
          <div className="eyebrow">BATCH</div>
          <strong>{session.label.trim() || session.batchId.trim() || "Untitled batch"}</strong>
        </div>
        <div className="batch-count-row">
          <Badge tone="positive">{review.validCount} ready</Badge>
          {review.invalidCount > 0 && (
            <Badge tone="danger">{review.invalidCount} need attention</Badge>
          )}
          {review.duplicateCount > 0 && (
            <Badge tone="neutral">{review.duplicateCount} duplicate</Badge>
          )}
          {review.warningCount > 0 && (
            <Badge tone="warning">{review.warningCount} warning</Badge>
          )}
        </div>
      </div>
      {alreadyReceived && (
        <div className="batch-resume-note" role="status">
          <CheckCircle2 size={14} />
          <span>This batch was already received; resubmitting will not duplicate its clips, positions, or findings.</span>
        </div>
      )}
      {review.invalidCount > 0 && (
        <div className="batch-block-note" role="alert">
          <AlertTriangle size={15} />
          <span>
            The batch cannot be received until every flagged row is fixed —
            no partial data is saved.
          </span>
        </div>
      )}
      <div className="batch-row-list">
        {session.rows.map((row, index) => (
          <BatchRowCard
            key={row.rowId}
            index={index}
            row={row}
            rowReview={review.rows[index]}
            state={state}
            onUpdate={(patch) => onUpdateRow(row.rowId, patch)}
            onRemove={() => onRemoveRow(row.rowId)}
          />
        ))}
      </div>
    </div>
  );
}

function RowCardShell({
  index,
  badge,
  rowReview,
  onRemove,
  children,
}: {
  index: number;
  badge: string;
  rowReview: ReturnType<typeof reviewBatch>["rows"][number];
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const tone = rowReview.duplicateOf
    ? "duplicate"
    : rowReview.errors.length
      ? "invalid"
      : "valid";
  return (
    <article className={`batch-row-card batch-row-${tone}`}>
      <header className="batch-row-head">
        <span className="batch-row-index">{String(index + 1).padStart(2, "0")}</span>
        <Badge tone={rowReview.errors.length ? "danger" : rowReview.duplicateOf ? "neutral" : "info"}>
          {badge}
        </Badge>
        {rowReview.duplicateOf && <Badge tone="neutral">Already in study — skip</Badge>}
        <Button variant="ghost" icon={<Trash2 size={14} />} aria-label="Remove row" onClick={onRemove} />
      </header>
      <div className="batch-row-fields">{children}</div>
      {rowReview.warnings.map((warning) => (
        <div className="batch-warning-line" key={warning}>
          <AlertTriangle size={13} /> {warning}
        </div>
      ))}
      {rowReview.errors.map((error) => (
        <div className="batch-error-line" key={`${error.field}-${error.message}`}>
          <XCircle size={13} /> {error.message}
        </div>
      ))}
    </article>
  );
}

function BatchRowCard({
  index,
  row,
  rowReview,
  state,
  onUpdate,
  onRemove,
}: {
  index: number;
  row: BatchRow;
  rowReview: ReturnType<typeof reviewBatch>["rows"][number];
  state: StudyState;
  onUpdate: (patch: Partial<BatchRow>) => void;
  onRemove: () => void;
}) {
  if (row.kind === "recording") {
    return (
      <RowCardShell index={index} badge="Clip" rowReview={rowReview} onRemove={onRemove}>
        <RecordingRowFields row={row} onUpdate={onUpdate} />
      </RowCardShell>
    );
  }
  if (row.kind === "placement") {
    return (
      <RowCardShell index={index} badge="Route position" rowReview={rowReview} onRemove={onRemove}>
        <PlacementRowFields row={row} state={state} onUpdate={onUpdate} />
      </RowCardShell>
    );
  }
  return (
    <RowCardShell index={index} badge="Finding" rowReview={rowReview} onRemove={onRemove}>
      <IssueRowFields row={row} onUpdate={onUpdate} />
    </RowCardShell>
  );
}

function MiniField({
  label,
  value,
  onChange,
  textarea,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  placeholder?: string;
}) {
  return (
    <label className={`field batch-mini-field ${textarea ? "span-2" : ""}`}>
      <span className="field-label">{label}</span>
      {textarea ? (
        <textarea
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function RecordingRowFields({
  row,
  onUpdate,
}: {
  row: BatchRecordingRow;
  onUpdate: (patch: Partial<BatchRecordingRow>) => void;
}) {
  const draft = row.draft;
  const updateDraft = (patch: Partial<RecordingDraft>) =>
    onUpdate({ draft: { ...draft, ...patch } });
  return (
    <>
      <MiniField label="Catalog ID" value={draft.catalogId} onChange={(value) => updateDraft({ catalogId: value })} />
      <MiniField label="Title" value={draft.title} onChange={(value) => updateDraft({ title: value })} />
      <MiniField label="Recorder / source" value={draft.source} onChange={(value) => updateDraft({ source: value })} />
      <MiniField label="Date" value={draft.recordedOn} onChange={(value) => updateDraft({ recordedOn: value })} placeholder="YYYY-MM-DD" />
      <MiniField label="Location" value={draft.location} onChange={(value) => updateDraft({ location: value })} />
      <MiniField label="Format" value={draft.format} onChange={(value) => updateDraft({ format: value })} />
      <MiniField label="Sample rate" value={draft.sampleRate} onChange={(value) => updateDraft({ sampleRate: value })} />
      <MiniField label="Channels" value={draft.channels} onChange={(value) => updateDraft({ channels: value })} />
      <MiniField label="Bit depth" value={draft.bitDepth} onChange={(value) => updateDraft({ bitDepth: value })} />
      <MiniField label="Duration (s)" value={draft.durationSeconds} onChange={(value) => updateDraft({ durationSeconds: value })} />
      <label className="field batch-mini-field">
        <span className="field-label">Signal role</span>
        <select
          value={draft.signalRole}
          onChange={(event) => updateDraft({ signalRole: event.target.value as RecordingDraft["signalRole"] })}
        >
          {["arrival", "texture", "voice", "departure"].map((role) => (
            <option key={role} value={role}>{titleCase(role)}</option>
          ))}
        </select>
      </label>
      <label className="field batch-mini-field">
        <span className="field-label">Sensitivity</span>
        <select
          value={draft.sensitivity}
          onChange={(event) => updateDraft({ sensitivity: event.target.value as RecordingDraft["sensitivity"] })}
        >
          {["public", "restricted", "sensitive"].map((option) => (
            <option key={option} value={option}>{titleCase(option)}</option>
          ))}
        </select>
      </label>
      <MiniField label="Site (optional)" value={row.siteRef ?? ""} onChange={(value) => onUpdate({ siteRef: value || undefined })} placeholder="Site name" />
      <MiniField label="Position (optional)" value={row.position ?? ""} onChange={(value) => onUpdate({ position: value || undefined })} placeholder="1-based" />
      <MiniField
        label="Summary"
        value={draft.summary}
        textarea
        onChange={(value) => updateDraft({ summary: value })}
      />
    </>
  );
}

function PlacementRowFields({
  row,
  state,
  onUpdate,
}: {
  row: BatchPlacementRow;
  state: StudyState;
  onUpdate: (patch: Partial<BatchPlacementRow>) => void;
}) {
  return (
    <>
      <MiniField label="Catalog ID" value={row.catalogId} onChange={(value) => onUpdate({ catalogId: value })} />
      <label className="field batch-mini-field">
        <span className="field-label">Listening site</span>
        <select value={row.siteRef} onChange={(event) => onUpdate({ siteRef: event.target.value })}>
          <option value="">Choose site…</option>
          {state.sites.map((site) => (
            <option key={site.id} value={site.name}>{site.name}</option>
          ))}
        </select>
      </label>
      <MiniField label="Position (optional)" value={row.position} onChange={(value) => onUpdate({ position: value })} placeholder="End if blank" />
    </>
  );
}

function IssueRowFields({
  row,
  onUpdate,
}: {
  row: BatchIssueRow;
  onUpdate: (patch: Partial<BatchIssueRow>) => void;
}) {
  return (
    <>
      <MiniField label="Finding title" value={row.title} onChange={(value) => onUpdate({ title: value })} />
      <label className="field batch-mini-field">
        <span className="field-label">Severity</span>
        <select value={row.severity} onChange={(event) => onUpdate({ severity: event.target.value as IssueSeverity })}>
          {["note", "warning", "critical"].map((severity) => (
            <option key={severity} value={severity}>{titleCase(severity)}</option>
          ))}
        </select>
      </label>
      <MiniField label="Owner" value={row.owner} onChange={(value) => onUpdate({ owner: value })} />
      <MiniField label="Linked site" value={row.siteRef} onChange={(value) => onUpdate({ siteRef: value })} placeholder="Site name" />
      <MiniField label="Linked clip" value={row.recordingRef} onChange={(value) => onUpdate({ recordingRef: value })} placeholder="Catalog ID" />
      <MiniField label="Context and next step" value={row.description} textarea onChange={(value) => onUpdate({ description: value })} />
    </>
  );
}
