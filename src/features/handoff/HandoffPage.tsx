import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSignature,
  History,
  Inbox,
  Lock,
  MapPin,
  Plus,
  Radio,
  ShieldAlert,
  Trash2,
  Undo2,
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
  buildPortableHandoff,
  handoffFileName,
  renderHandoffMarkdown,
  serializePortableHandoff,
} from "../../domain/handoffExport";
import { formatDate, titleCase } from "../../domain/formatters";
import type {
  HandoffChange,
  HandoffItem,
  HandoffPacket,
} from "../../domain/models";
import { downloadTextFile } from "../../domain/export";
import {
  pendingHandoff,
  provenanceOf,
} from "../../domain/handoff";
import type { HandoffOpenItemInput } from "../../state/actions";
import { useStudy } from "../../state/StudyContext";

type OpenItemDraft = HandoffOpenItemInput & { id: string };

export function HandoffPage() {
  const {
    state,
    beginHandoff,
    createHandoff,
    decideHandoff,
    withdrawHandoff,
  } = useStudy();
  const [showPrepare, setShowPrepare] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pending = pendingHandoff(state);
  const sessionActive = Boolean(state.activeBaseline) && !pending;
  const history = useMemo(
    () => [...state.handoffs].reverse(),
    [state.handoffs],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const startSession = () => {
    const result = beginHandoff();
    notify(
      result.ok
        ? "Offline session started. Work normally; every change is tracked against this baseline."
        : result.message ?? "Could not start the session.",
    );
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="FIELD HANDOFF"
        title="Offline handover"
        description="Pass one portable, confirmable checklist to the next colleague. New clips, site changes, and findings stay out of release decisions until the receiver accepts the scope."
        actions={
          <div className="header-button-row">
            {sessionActive && (
              <Button
                variant="primary"
                icon={<FileSignature size={16} />}
                onClick={() => setShowPrepare(true)}
              >
                Prepare handoff
              </Button>
            )}
            {!sessionActive && !pending && (
              <Button
                variant="secondary"
                icon={<Radio size={16} />}
                onClick={startSession}
              >
                Start offline session
              </Button>
            )}
          </div>
        }
      />

      {sessionActive && <SessionBanner baselineCapturedAt={state.activeBaseline!.capturedAt} />}
      {pending && (
        <PendingHandoffCard
          packet={pending}
          onDecide={(decision, name, note) => {
            const result = decideHandoff(pending.id, decision, name, note);
            if (result.ok) {
              notify(
                decision === "accepted"
                  ? "Handoff accepted. Its scope now enters release judgment."
                  : "Handoff declined. Introduced clips and findings were rolled back.",
              );
            } else {
              notify(result.message ?? "Decision could not be recorded.");
            }
            return result;
          }}
          onWithdraw={() => {
            const result = withdrawHandoff(pending.id);
            notify(
              result.ok
                ? "Handoff withdrawn. The session is open again; prepare a fresh packet after your changes."
                : result.message ?? "Could not withdraw the handoff.",
            );
            return result;
          }}
          onDownload={(format) => {
            const portable = buildPortableHandoff(state, pending);
            if (format === "md") {
              downloadTextFile(
                renderHandoffMarkdown(portable),
                handoffFileName(pending).replace(/\.json$/, ".md"),
                "text/markdown;charset=utf-8",
              );
            } else {
              downloadTextFile(
                serializePortableHandoff(portable),
                handoffFileName(pending),
              );
            }
          }}
        />
      )}

      <section className="handoff-history">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">
              <History size={12} /> HANDOFF HISTORY
            </div>
            <h2>Where each piece of work came from</h2>
          </div>
          <Badge tone="neutral">{history.length} packet{history.length === 1 ? "" : "s"}</Badge>
        </div>
        {history.length === 0 ? (
          <EmptyState
            icon={<Inbox size={26} />}
            title="No handoffs yet"
            detail="Start an offline session before fieldwork so the outgoing and receiving colleagues share one confirmed scope."
          />
        ) : (
          history.map((packet) => (
            <HistoryPacket key={packet.id} packet={packet} />
          ))
        )}
      </section>

      <ProvenanceIndex />

      {showPrepare && (
        <PrepareHandoffModal
          state={state}
          onClose={() => setShowPrepare(false)}
          onCreate={(draft) => {
            const result = createHandoff(draft);
            if (result.ok) {
              setShowPrepare(false);
              notify("Handoff packet prepared and quarantined pending confirmation.");
            }
            return result;
          }}
        />
      )}
      {toast && (
        <div className="toast toast-positive">
          <ArrowRightLeft size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function SessionBanner({ baselineCapturedAt }: { baselineCapturedAt: string }) {
  return (
    <section className="handoff-banner">
      <Radio size={20} />
      <div>
        <div className="eyebrow">OFFLINE SESSION ACTIVE</div>
        <h2>Changes since {formatDate(baselineCapturedAt)} are being tracked</h2>
        <p>
          Finish your work, then prepare the handoff. The packet freezes the
          change list and quarantines new content until the next colleague
          confirms it.
        </p>
      </div>
    </section>
  );
}

const CHANGE_GROUPS: Array<{
  title: string;
  match: (kind: HandoffChange["kind"]) => boolean;
}> = [
  { title: "Recordings", match: (kind) => kind.startsWith("recording-") },
  { title: "Listening route", match: (kind) => kind.startsWith("placement-") },
  { title: "Quality findings", match: (kind) => kind.startsWith("issue-") },
];

function PendingHandoffCard({
  packet,
  onDecide,
  onWithdraw,
  onDownload,
}: {
  packet: HandoffPacket;
  onDecide: (
    decision: "accepted" | "declined",
    name: string,
    note: string,
  ) => { ok: boolean; errors?: Record<string, string>; message?: string };
  onWithdraw: () => { ok: boolean; message?: string };
  onDownload: (format: "json" | "md") => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const decide = (decision: "accepted" | "declined") => {
    const result = onDecide(decision, name, note);
    if (!result.ok)
      setErrors(result.errors ?? { receiverName: result.message ?? "Decision failed." });
  };

  return (
    <section className="handoff-pending" aria-label="Pending handoff">
      <div className="pending-lock">
        <Lock size={24} />
      </div>
      <div className="pending-head">
        <div>
          <div className="eyebrow">AWAITING RECEIVER CONFIRMATION</div>
          <h2>Handoff #{packet.sequence} · {packet.outgoingName}</h2>
          <p>
            {packet.outgoingRole ? <>{packet.outgoingRole} · </> : null}
            prepared {formatDate(packet.createdAt)} for{" "}
            <strong>{packet.incomingName}</strong>. Revisions{" "}
            {packet.revisionRange.from} → {packet.revisionRange.to}.
          </p>
        </div>
        <div className="pending-actions">
          <Button variant="secondary" icon={<Download size={15} />} onClick={() => onDownload("json")}>
            Portable list
          </Button>
          <Button variant="ghost" icon={<ClipboardList size={15} />} onClick={() => onDownload("md")}>
            Printable checklist
          </Button>
          <Button
            variant="ghost"
            icon={<Undo2 size={15} />}
            onClick={() => {
              if (
                window.confirm(
                  "Withdraw this handoff to make more changes? The receiver must then confirm a freshly prepared packet.",
                )
              )
                onWithdraw();
            }}
          >
            Withdraw &amp; keep editing
          </Button>
        </div>
      </div>
      {packet.note && <blockquote className="pending-note">{packet.note}</blockquote>}

      <div className="pending-counts">
        <span><strong>{packet.changes.filter((c) => c.kind.startsWith("recording-")).length}</strong> recordings</span>
        <span><strong>{packet.changes.filter((c) => c.kind.startsWith("placement-")).length}</strong> route changes</span>
        <span><strong>{packet.changes.filter((c) => c.kind.startsWith("issue-")).length}</strong> findings</span>
        <span><strong>{packet.openItems.length}</strong> unfinished items</span>
      </div>

      {CHANGE_GROUPS.map((group) => {
        const changes = packet.changes.filter((change) => group.match(change.kind));
        if (!changes.length) return null;
        return (
          <div className="change-group" key={group.title}>
            <div className="eyebrow">{group.title.toUpperCase()}</div>
            <ul className="change-list">
              {changes.map((change) => (
                <li key={change.id} className={`change-row change-${change.kind}`}>
                  <ChangeIcon kind={change.kind} />
                  <span className="change-summary">{change.summary}</span>
                  {change.siteName && (
                    <span className="change-site">
                      <MapPin size={12} /> {change.siteName}
                    </span>
                  )}
                  <span className="change-date">{formatDate(change.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {packet.openItems.length > 0 && (
        <div className="change-group">
          <div className="eyebrow">UNFINISHED ITEMS</div>
          <ul className="handover-items">
            {packet.openItems.map((item) => (
              <li key={item.id} className={`handover-item item-${item.severity}`}>
                <ShieldAlert size={15} />
                <div>
                  <strong>[{item.severity.toUpperCase()}] {item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pending-signoff">
        <div className="signoff-copy">
          <Lock size={16} />
          <span>
            Until the receiver accepts or declines (or you withdraw the packet
            to edit further), every clip, placement, finding, and preference is
            locked so this checklist cannot drift from what is taken over.
          </span>
        </div>
        <div className="signoff-form">
          <TextField
            label="Receiving colleague"
            value={name}
            error={errors.receiverName}
            placeholder="Your name"
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Receiver note (optional)"
            value={note}
            placeholder="Anything the outgoing team should know?"
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="signoff-buttons">
            <Button variant="primary" icon={<Check size={15} />} onClick={() => decide("accepted")}>
              Confirm &amp; accept scope
            </Button>
            <Button variant="danger" icon={<XCircle size={15} />} onClick={() => decide("declined")}>
              Decline handoff
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChangeIcon({ kind }: { kind: HandoffChange["kind"] }) {
  if (kind.endsWith("-removed")) return <XCircle size={15} className="change-icon-removed" />;
  if (kind.endsWith("-added")) return <Plus size={15} className="change-icon-added" />;
  return <ArrowRightLeft size={15} className="change-icon-changed" />;
}

function HistoryPacket({ packet }: { packet: HandoffPacket }) {
  const [open, setOpen] = useState(false);
  const tone =
    packet.status === "accepted"
      ? "positive"
      : packet.status === "declined"
        ? "danger"
        : packet.status === "withdrawn"
          ? "neutral"
          : "warning";
  return (
    <article className="history-packet">
      <button className="history-summary" onClick={() => setOpen((value) => !value)}>
        <span className={`history-status history-${packet.status}`}>
          {packet.status === "accepted" ? (
            <CheckCircle2 size={17} />
          ) : packet.status === "declined" ? (
            <XCircle size={17} />
          ) : packet.status === "withdrawn" ? (
            <Undo2 size={17} />
          ) : (
            <Lock size={17} />
          )}
        </span>
        <span className="history-main">
          <strong>
            #{packet.sequence} · {packet.outgoingName} → {packet.incomingName}
          </strong>
          <small>
            {formatDate(packet.createdAt)} · {packet.changes.length} changes ·{" "}
            {packet.openItems.length} open items
            {packet.status === "withdrawn"
              ? " · withdrawn before confirmation"
              : packet.receiverName
                ? ` · decided by ${packet.receiverName}`
                : ""}
          </small>
        </span>
        <Badge tone={tone}>{titleCase(packet.status)}</Badge>
      </button>
      {open && (
        <div className="history-detail">
          {packet.note && <p className="history-note">{packet.note}</p>}
          <ul className="change-list">
            {packet.changes.map((change) => (
              <li key={change.id} className="change-row">
                <ChangeIcon kind={change.kind} />
                <span className="change-summary">{change.summary}</span>
                {change.siteName && (
                  <span className="change-site">
                    <MapPin size={12} /> {change.siteName}
                  </span>
                )}
                <span className="change-date">{formatDate(change.at)}</span>
              </li>
            ))}
          </ul>
          {packet.openItems.length > 0 && (
            <>
              <div className="eyebrow">UNFINISHED ITEMS</div>
              <ul className="handover-items">
                {packet.openItems.map((item) => (
                  <li key={item.id} className={`handover-item item-${item.severity}`}>
                    <ShieldAlert size={15} />
                    <div>
                      <strong>
                        [{item.severity.toUpperCase()}] {item.title}
                      </strong>
                      <p>{item.detail}</p>
                    </div>
                    <Badge tone={item.status === "accepted" ? "positive" : item.status === "declined" ? "danger" : "warning"}>
                      {titleCase(item.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
          {packet.receiverNote && (
            <p className="history-receiver-note">
              <UserRound size={13} /> {packet.receiverName}: {packet.receiverNote}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function ProvenanceIndex() {
  const { state } = useStudy();
  const traced = useMemo(
    () =>
      [
        ...state.recordings
          .filter((recording) => recording.handoffId)
          .map((recording) => ({
            id: recording.id,
            title: recording.title,
            meta: recording.catalogId,
            handoffId: recording.handoffId as string,
          })),
        ...state.issues
          .filter((issue) => issue.handoffId)
          .map((issue) => ({
            id: issue.id,
            title: issue.title,
            meta: "Quality finding",
            handoffId: issue.handoffId as string,
          })),
      ],
    [state.recordings, state.issues],
  );
  if (!traced.length) return null;
  return (
    <section className="provenance-index">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SOURCE TRACE</div>
          <h2>Work introduced through a handoff</h2>
        </div>
      </div>
      <ul className="provenance-list">
        {traced.map((entry) => {
          const packet = provenanceOf(state, entry.handoffId);
          return (
            <li key={entry.id} className="provenance-row">
              <ArrowRightLeft size={14} />
              <span className="change-summary">
                <strong>{entry.title}</strong> <small>{entry.meta}</small>
              </span>
              <Badge tone={packet?.status === "accepted" ? "positive" : "warning"}>
                Handoff #{packet?.sequence ?? "?"} · {packet?.outgoingName ?? "unknown"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface PrepareDraft {
  outgoingName: string;
  outgoingRole: string;
  incomingName: string;
  note: string;
  openItems: OpenItemDraft[];
}

function PrepareHandoffModal({
  state,
  onClose,
  onCreate,
}: {
  state: ReturnType<typeof useStudy>["state"];
  onClose: () => void;
  onCreate: (draft: PrepareDraft) => {
    ok: boolean;
    errors?: Record<string, string>;
    message?: string;
  };
}) {
  const [draft, setDraft] = useState<PrepareDraft>({
    outgoingName: "",
    outgoingRole: "",
    incomingName: "",
    note: "",
    openItems: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof PrepareDraft>(key: K, value: PrepareDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateItem = (id: string, patch: Partial<OpenItemDraft>) => {
    setDraft((current) => ({
      ...current,
      openItems: current.openItems.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  };
  const addItem = () =>
    setDraft((current) => ({
      ...current,
      openItems: [
        ...current.openItems,
        {
          id: `draft-${current.openItems.length}-${Date.now()}`,
          title: "",
          detail: "",
          severity: "warning",
          recordingId: "",
          siteId: "",
        },
      ],
    }));
  const removeItem = (id: string) =>
    setDraft((current) => ({
      ...current,
      openItems: current.openItems.filter((item) => item.id !== id),
    }));

  return (
    <Modal
      eyebrow="PREPARE FIELD HANDOFF"
      title="Freeze this offline session"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<FileSignature size={15} />}
            onClick={() => {
              const result = onCreate(draft);
              if (!result.ok) setErrors(result.errors ?? {});
            }}
          >
            Prepare packet
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Outgoing colleague"
          value={draft.outgoingName}
          error={errors.outgoingName}
          placeholder="Who completed this work?"
          onChange={(event) => update("outgoingName", event.target.value)}
        />
        <TextField
          label="Role / crew"
          value={draft.outgoingRole}
          placeholder="Morning capture team"
          onChange={(event) => update("outgoingRole", event.target.value)}
        />
        <TextField
          label="Receiving colleague"
          value={draft.incomingName}
          error={errors.incomingName}
          placeholder="Who takes over?"
          onChange={(event) => update("incomingName", event.target.value)}
        />
        <TextField
          label="Session note"
          value={draft.note}
          placeholder="Weather, access issues, anything unusual…"
          onChange={(event) => update("note", event.target.value)}
        />
      </div>
      <div className="handover-editor">
        <div className="panel-heading">
          <div className="eyebrow">UNFINISHED ITEMS</div>
          <Button variant="ghost" icon={<Plus size={14} />} onClick={addItem}>
            Add item
          </Button>
        </div>
        {draft.openItems.length === 0 && (
          <p className="handover-empty">
            No items yet. Flag anything the receiver must finish before release.
          </p>
        )}
        {draft.openItems.map((item) => (
          <div className="handover-edit-row" key={item.id}>
            <TextField
              label="What remains?"
              value={item.title}
              placeholder="Follow up consent call"
              onChange={(event) =>
                updateItem(item.id, { title: event.target.value })
              }
            />
            <TextField
              label="Detail"
              value={item.detail}
              placeholder="Context and the next action"
              onChange={(event) =>
                updateItem(item.id, { detail: event.target.value })
              }
            />
            <SelectField
              label="Severity"
              value={item.severity}
              onChange={(event) =>
                updateItem(item.id, {
                  severity: event.target.value as HandoffItem["severity"],
                })
              }
            >
              <option value="note">Note</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </SelectField>
            <SelectField
              label="Linked site"
              value={item.siteId ?? ""}
              onChange={(event) =>
                updateItem(item.id, { siteId: event.target.value })
              }
            >
              <option value="">No site</option>
              {state.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectField>
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              aria-label="Remove handover item"
              onClick={() => removeItem(item.id)}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
