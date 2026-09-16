import {
  Archive,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  FileText,
  History,
  Link2,
  MapPin,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  UserRound,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import {
  CONSENT_PURPOSES,
  latestGrantFor,
  summarizeConsentImpact,
  type ConsentImpact,
} from "../../domain/consent";
import { formatDate, titleCase } from "../../domain/formatters";
import {
  consentDescriptions,
  consentPurposeDescriptions,
  grantStatusDescriptions,
} from "../../domain/labels";
import { isReleaseCurrent } from "../../domain/releaseRules";
import type {
  ConsentGrant,
  ConsentPurpose,
  ConsentStatus,
  Recording,
  Snapshot,
} from "../../domain/models";
import { useStudy } from "../../state/StudyContext";

type StatusFilter = ConsentStatus | "all";
const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "confirmed",
  "restricted",
  "pending",
  "expired",
  "withdrawn",
];

const toneForStatus: Record<
  ConsentStatus,
  "positive" | "warning" | "danger" | "neutral"
> = {
  confirmed: "positive",
  restricted: "warning",
  pending: "neutral",
  expired: "danger",
  withdrawn: "danger",
};

type EditorMode = "grant" | "restrict" | "withdraw";

interface EditorState {
  mode: EditorMode;
  recordingId: string;
}

export function ConsentPage() {
  const {
    state,
    recordConsent,
    restrictConsent,
    withdrawConsent,
    checkReadiness,
  } = useStudy();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const impacts = useMemo(
    () => summarizeConsentImpact(state.recordings, state.consents, state.sites),
    [state.recordings, state.consents, state.sites],
  );
  const siteNameById = new Map(state.sites.map((site) => [site.id, site]));
  const filtered = impacts.filter(
    (impact) => filter === "all" || impact.status === filter,
  );

  const counts = {
    all: impacts.length,
    confirmed: impacts.filter((item) => item.status === "confirmed").length,
    restricted: impacts.filter((item) => item.status === "restricted").length,
    pending: impacts.filter((item) => item.status === "pending").length,
    expired: impacts.filter((item) => item.status === "expired").length,
    withdrawn: impacts.filter((item) => item.status === "withdrawn").length,
  };
  const blocking = impacts.filter((impact) => impact.blocksRoute);
  const placedBlocking = blocking.filter((impact) => impact.placed);
  const archiveGaps = impacts.filter((impact) => impact.archiveGap);
  const releaseCurrent = isReleaseCurrent(state, state.release);

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 2800);
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="CONSENT LEDGER"
        title="Consent lifecycle"
        description="Track who granted consent, for which purposes, and until when. Withdrawals and scope changes propagate to sites, checklists, and pending releases immediately."
        actions={
          <Button
            variant="primary"
            icon={<Stamp size={16} />}
            onClick={() => setEditor({ mode: "grant", recordingId: "" })}
          >
            Record consent
          </Button>
        }
      />
      <div className="summary-strip consent-strip">
        <div>
          <span className="eyebrow">CLIPS WITH ACTIVE CONSENT</span>
          <strong>
            {impacts.filter((item) => item.purposes.includes("route")).length}
            <small> of {impacts.length}</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">BLOCKING NEW USE</span>
          <strong className="text-danger">
            {blocking.length}
            <small> clips</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">PLACED WITHOUT USABLE CONSENT</span>
          <strong className="text-danger">
            {placedBlocking.length}
            <small> site clips</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">ARCHIVE GAPS</span>
          <strong className="text-amber">
            {archiveGaps.length}
            <small> route-only</small>
          </strong>
        </div>
      </div>
      <section
        className={`consent-banner ${placedBlocking.length ? "danger" : "clear"}`}
      >
        <div className="consent-banner-icon">
          {placedBlocking.length ? (
            <ShieldAlert size={24} />
          ) : (
            <ShieldCheck size={24} />
          )}
        </div>
        <div className="consent-banner-copy">
          {placedBlocking.length ? (
            <>
              <strong>
                {placedBlocking.length} placed clip
                {placedBlocking.length === 1 ? "" : "s"} can no longer be used
              </strong>
              <p>
                Consent was withdrawn, expired, or narrowed. The clips stay in
                the route history, but sites, field checklists, and pending
                release decisions now mark them as blocking.
              </p>
            </>
          ) : blocking.length ? (
            <>
              <strong>{blocking.length} unplaced clips lack usable consent</strong>
              <p>
                They cannot be placed into a site or used to generate new
                content until consent is recorded.
              </p>
            </>
          ) : (
            <>
              <strong>Every placed clip has usable route consent</strong>
              <p>
                Scope changes would immediately flag affected sites, checklists,
                and pending releases here.
              </p>
            </>
          )}
        </div>
        {state.release && (
          <div className="consent-release-state">
            <Badge tone={releaseCurrent ? "positive" : "warning"}>
              Release #{state.release.sequence} ·{" "}
              {titleCase(state.release.status)}
            </Badge>
            <Button
              variant="secondary"
              icon={<FileSignature size={15} />}
              onClick={() => {
                const result = checkReadiness();
                notify(
                  result.ready
                    ? "Readiness re-checked against the current consent ledger."
                    : `${result.blockers.length} blocker(s) found; new release is held.`,
                );
              }}
            >
              Re-check release
            </Button>
          </div>
        )}
      </section>
      <div className="review-toolbar">
        <div className="segmented-control">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              data-testid={`consent-filter-${status}`}
              className={filter === status ? "selected" : ""}
              onClick={() => setFilter(status)}
            >
              {status === "all" ? "All" : consentDescriptions[status]}{" "}
              <span>{counts[status]}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="consent-list">
        {filtered.map((impact) => (
          <ConsentCard
            key={impact.recordingId}
            impact={impact}
            grant={latestGrantFor(impact.recordingId, state.consents)}
            history={state.consents
              .filter(
                (grant) => grant.recordingId === impact.recordingId,
              )
              .sort(
                (left, right) =>
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              )}
            sites={impact.siteIds
              .map((id) => siteNameById.get(id))
              .filter((site): site is NonNullable<typeof site> =>
                Boolean(site),
              )}
            snapshotBasis={
              state.release?.snapshot &&
              basisInSnapshot(state.release.snapshot, impact.recordingId)
            }
            onRecord={() =>
              setEditor({ mode: "grant", recordingId: impact.recordingId })
            }
            onRestrict={() =>
              setEditor({ mode: "restrict", recordingId: impact.recordingId })
            }
            onWithdraw={() =>
              setEditor({ mode: "withdraw", recordingId: impact.recordingId })
            }
          />
        ))}
      </section>
      {filtered.length === 0 && (
        <EmptyState
          icon={<ShieldCheck size={26} />}
          title="No clips match this standing"
          detail="Switch filters to see other consent decisions."
        />
      )}
      {editor && (
        <ConsentEditor
          mode={editor.mode}
          recordings={state.recordings}
          initialRecordingId={editor.recordingId}
          existing={
            editor.recordingId
              ? latestGrantFor(editor.recordingId, state.consents)
              : undefined
          }
          onClose={() => setEditor(null)}
          onSave={(recordingId, input) => {
            const action = {
              grant: recordConsent,
              restrict: restrictConsent,
              withdraw: withdrawConsent,
            }[editor.mode];
            const result = action(
              recordingId,
              // Withdraw only needs provenance fields; the context fills scope.
              input as Parameters<typeof recordConsent>[1],
            );
            if (!result.ok) return result;
            setEditor(null);
            notify(
              editor.mode === "withdraw"
                ? "Consent withdrawn. Affected sites and pending releases now block new use."
                : editor.mode === "restrict"
                  ? "Consent scope narrowed and propagated to linked content."
                  : "Consent recorded on the clip's ledger.",
            );
            return result;
          }}
        />
      )}
      {feedback && <div className="toast toast-positive">{feedback}</div>}
    </div>
  );
}

function basisInSnapshot(
  snapshot: Snapshot,
  recordingId: string,
): Snapshot["sites"][number]["recordings"][number]["consentBasis"] {
  for (const site of snapshot.sites) {
    const found = site.recordings.find(
      (recording) => recording.id === recordingId,
    );
    if (found) return found.consentBasis;
  }
  return undefined;
}

const PURPOSE_ICONS: Record<ConsentPurpose, typeof MapPin> = {
  route: MapPin,
  transcript: FileText,
  archive: Archive,
};

function ConsentCard({
  impact,
  grant,
  history,
  sites,
  snapshotBasis,
  onRecord,
  onRestrict,
  onWithdraw,
}: {
  impact: ConsentImpact;
  grant?: ConsentGrant;
  history: ConsentGrant[];
  sites: Array<{ id: string; name: string; shortLabel: string }>;
  snapshotBasis?: Snapshot["sites"][number]["recordings"][number]["consentBasis"];
  onRecord: () => void;
  onRestrict: () => void;
  onWithdraw: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <article
      className={`consent-card consent-${impact.status}`}
      data-testid={`consent-card-${impact.recordingId}`}
    >
      <div className="consent-card-head">
        <div>
          <div className="recording-id">{impact.catalogId}</div>
          <h3>{impact.title}</h3>
          <div className="consent-status-line">
            <Badge tone={toneForStatus[impact.status]}>
              {consentDescriptions[impact.status]}
            </Badge>
            {grant && (
              <span className="consent-provenance">
                <UserRound size={13} /> {grant.grantedBy} · {grant.channel}
              </span>
            )}
            {grant?.expiresAt && (
              <span className="consent-expiry">
                <CalendarClock size={13} />
                {new Date(grant.expiresAt).getTime() < Date.now()
                  ? `Expired ${formatDate(grant.expiresAt)}`
                  : `Valid until ${formatDate(grant.expiresAt)}`}
              </span>
            )}
          </div>
        </div>
        <div className="consent-card-actions">
          <Button variant="secondary" icon={<Stamp size={14} />} onClick={onRecord}>
            Record
          </Button>
          <Button
            variant="secondary"
            icon={<ShieldAlert size={14} />}
            onClick={onRestrict}
            disabled={impact.status === "pending" || impact.status === "withdrawn"}
          >
            Narrow scope
          </Button>
          <Button
            variant="ghost"
            icon={<XCircle size={14} />}
            onClick={onWithdraw}
            disabled={impact.status === "withdrawn"}
          >
            Withdraw
          </Button>
        </div>
      </div>
      <div className="consent-purposes">
        {CONSENT_PURPOSES.map((purpose) => {
          const Icon = PURPOSE_ICONS[purpose];
          const covered = impact.purposes.includes(purpose);
          return (
            <span
              key={purpose}
              className={`consent-purpose ${covered ? "covered" : "uncovered"}`}
              data-testid={`purpose-${impact.recordingId}-${purpose}`}
            >
              <Icon size={14} />
              {consentPurposeDescriptions[purpose]}
              {covered ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            </span>
          );
        })}
      </div>
      {grant?.evidenceRef && (
        <div className="consent-evidence">
          <ScrollText size={14} />
          <span>
            <strong>Evidence:</strong> {grant.evidenceRef}
          </span>
          {grant.note && <em>— {grant.note}</em>}
        </div>
      )}
      <div className="consent-impact-row">
        <div className="consent-sites">
          <Link2 size={14} />
          {sites.length ? (
            sites.map((site) => (
              <Badge
                key={site.id}
                tone={impact.blocksRoute ? "danger" : "info"}
              >
                {site.shortLabel}
              </Badge>
            ))
          ) : (
            <span className="consent-muted">Not placed in a site</span>
          )}
        </div>
        {impact.archiveGap && (
          <Badge tone="warning">Route cleared, archive not released</Badge>
        )}
      </div>
      {snapshotBasis && (
        <div className="consent-frozen">
          <FileSignature size={14} />
          <span>
            <strong>Last release basis:</strong>{" "}
            {grantStatusDescriptions[snapshotBasis.status]} consent from{" "}
            {snapshotBasis.grantedBy} ({snapshotBasis.evidenceRef}) for{" "}
            {snapshotBasis.purposes.join(", ")} — frozen at{" "}
            {formatDate(snapshotBasis.resolvedAt)}. Published content keeps this
            basis even if the current ledger changes.
          </span>
        </div>
      )}
      {history.length > 1 && (
        <div className="consent-history">
          <button
            className="consent-history-toggle"
            onClick={() => setShowHistory((value) => !value)}
          >
            <History size={13} />
            {showHistory ? "Hide" : "Show"} decision history ({history.length})
          </button>
          {showHistory && (
            <ol className="consent-history-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <Badge
                    tone={
                      entry.status === "active"
                        ? "positive"
                        : entry.status === "restricted"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {grantStatusDescriptions[entry.status]}
                  </Badge>
                  <span>
                    {entry.purposes.length
                      ? entry.purposes.join(", ")
                      : "no purposes"}
                    {" · "}
                    {entry.grantedBy} · {formatDate(entry.createdAt)}
                    {entry.expiresAt ? ` · until ${entry.expiresAt}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

interface ConsentFormState {
  recordingId: string;
  purposes: ConsentPurpose[];
  grantedBy: string;
  channel: string;
  evidenceRef: string;
  grantedAt: string;
  expiresAt: string;
  note: string;
}

function initialForm(
  mode: EditorMode,
  recordings: Recording[],
  initialRecordingId: string,
  existing?: ConsentGrant,
): ConsentFormState {
  const today = new Date().toISOString().slice(0, 10);
  if (existing) {
    return {
      recordingId: initialRecordingId,
      purposes:
        mode === "grant"
          ? Array.from(new Set([...existing.purposes, "route"] as ConsentPurpose[]))
          : existing.purposes,
      grantedBy: existing.grantedBy,
      channel: existing.channel,
      evidenceRef: "",
      grantedAt: today,
      // A fresh grant (including a renewal) starts open-ended; a restriction
      // carries the prior expiry forward for review.
      expiresAt: mode === "restrict" ? (existing.expiresAt ?? "") : "",
      note: "",
    };
  }
  return {
    recordingId: initialRecordingId || recordings[0]?.id || "",
    purposes: mode === "withdraw" ? [] : ["route"],
    grantedBy: "",
    channel: "",
    evidenceRef: "",
    grantedAt: today,
    expiresAt: "",
    note: "",
  };
}

function ConsentEditor({
  mode,
  recordings,
  initialRecordingId,
  existing,
  onClose,
  onSave,
}: {
  mode: EditorMode;
  recordings: Recording[];
  initialRecordingId: string;
  existing?: ConsentGrant;
  onClose: () => void;
  onSave: (
    recordingId: string,
    input: {
      purposes: ConsentPurpose[];
      grantedBy: string;
      channel: string;
      evidenceRef: string;
      grantedAt: string;
      expiresAt?: string;
      note: string;
    },
  ) => { ok: boolean; errors?: Record<string, string>; message?: string };
}) {
  const [form, setForm] = useState<ConsentFormState>(() =>
    initialForm(mode, recordings, initialRecordingId, existing),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof ConsentFormState>(
    key: K,
    value: ConsentFormState[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const togglePurpose = (purpose: ConsentPurpose) =>
    setForm((current) => ({
      ...current,
      purposes: current.purposes.includes(purpose)
        ? current.purposes.filter((item) => item !== purpose)
        : [...current.purposes, purpose],
    }));

  const heading = {
    grant: ["RECORD CONSENT", "Record a new consent decision"],
    restrict: ["NARROW SCOPE", "Restrict the purposes this consent covers"],
    withdraw: ["WITHDRAW CONSENT", "Record a withdrawal of consent"],
  }[mode];

  return (
    <Modal
      eyebrow={heading[0]}
      title={heading[1]}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={mode === "withdraw" ? "danger" : "primary"}
            icon={<Stamp size={15} />}
            onClick={() => {
              const result = onSave(form.recordingId, {
                purposes: form.purposes,
                grantedBy: form.grantedBy,
                channel: form.channel,
                evidenceRef: form.evidenceRef,
                grantedAt: form.grantedAt,
                expiresAt: form.expiresAt || undefined,
                note: form.note,
              });
              if (!result.ok) setErrors(result.errors ?? {});
            }}
          >
            {mode === "withdraw"
              ? "Confirm withdrawal"
              : mode === "restrict"
                ? "Save restricted scope"
                : "Record consent"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <SelectField
          label="Clip"
          value={form.recordingId}
          onChange={(event) => update("recordingId", event.target.value)}
        >
          {recordings.map((recording) => (
            <option key={recording.id} value={recording.id}>
              {recording.catalogId} — {recording.title}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Decision date"
          type="date"
          value={form.grantedAt}
          onChange={(event) => update("grantedAt", event.target.value)}
        />
        {mode !== "withdraw" && (
          <div className="consent-purpose-editor">
            <span className="field-label">Authorized purposes</span>
            <div className="consent-purpose-checks">
              {CONSENT_PURPOSES.map((purpose) => (
                <label className="check-field" key={purpose}>
                  <input
                    type="checkbox"
                    checked={form.purposes.includes(purpose)}
                    onChange={() => togglePurpose(purpose)}
                  />
                  <span>
                    <strong>{consentPurposeDescriptions[purpose]}</strong>
                  </span>
                </label>
              ))}
            </div>
            {errors.purposes && (
              <div className="field-error">{errors.purposes}</div>
            )}
          </div>
        )}
        {mode !== "withdraw" && (
          <TextField
            label="Valid until (optional)"
            type="date"
            value={form.expiresAt}
            onChange={(event) => update("expiresAt", event.target.value)}
            hint="Leave open for consent without an expiry date."
          />
        )}
        <TextField
          label="Granted / withdrawn by"
          value={form.grantedBy}
          onChange={(event) => update("grantedBy", event.target.value)}
          error={errors.grantedBy}
          placeholder="Person, circle, or representative"
        />
        <TextField
          label="Channel"
          value={form.channel}
          onChange={(event) => update("channel", event.target.value)}
          error={errors.channel}
          placeholder="Signed form, email, verbal with witness…"
        />
        <TextField
          label="Evidence reference"
          value={form.evidenceRef}
          onChange={(event) => update("evidenceRef", event.target.value)}
          error={errors.evidenceRef}
          placeholder="FORM-2026-040 / email id / note location"
        />
        <TextField
          label={mode === "withdraw" ? "Withdrawal note" : "Scope note"}
          textarea
          rows={4}
          value={form.note}
          onChange={(event) => update("note", event.target.value)}
          hint={
            mode === "withdraw"
              ? "Explain the withdrawal. Existing published releases keep their frozen basis; new use is blocked."
              : "Record conditions or limits on this consent."
          }
        />
      </div>
    </Modal>
  );
}
