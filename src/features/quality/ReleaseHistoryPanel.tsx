import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileWarning,
  GitBranch,
  History,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Callout } from "../../components/Callout";
import { Modal } from "../../components/Modal";
import { formatDate, formatMinutes, titleCase } from "../../domain/formatters";
import {
  canForkDraft,
  describeReleaseStatus,
  diffReleases,
  type IssueChange,
  type RecordingChange,
  type ReleaseDiff,
  type ReleaseLineageStatus,
  type SiteChange,
} from "../../domain/releaseHistory";
import { releaseFingerprint } from "../../domain/releaseIdentity";
import type { ReleaseRecord, StudyState } from "../../domain/models";
import { useStudy } from "../../state/StudyContext";

const STATUS_TONE: Record<ReleaseLineageStatus, "positive" | "warning" | "danger" | "neutral" | "info"> = {
  current: "positive",
  stale: "warning",
  superseded: "neutral",
  blocked: "danger",
  "blocked-superseded": "neutral",
};

function VersionLabel({ sequence }: { sequence: number }) {
  return <span className="release-version">v{sequence}</span>;
}

export function ReleaseHistoryButton() {
  const { state } = useStudy();
  const [open, setOpen] = useState(false);
  const count = state.releaseHistory.length;
  return (
    <>
      <Button
        variant="secondary"
        icon={<History size={16} />}
        onClick={() => setOpen(true)}
      >
        Release history{count ? ` (${count})` : ""}
      </Button>
      {open && <ReleaseHistoryModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReleaseHistoryModal({ onClose }: { onClose: () => void }) {
  const { state, restoreDraftFromRelease } = useStudy();
  const history = useMemo(
    () => [...state.releaseHistory].sort((a, b) => b.sequence - a.sequence),
    [state.releaseHistory],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    history[0]?.id ?? null,
  );
  const [compareId, setCompareId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = history.find((entry) => entry.id === selectedId) ?? null;
  const compareCandidates = history
    .filter((entry) => entry.sequence < (selected?.sequence ?? Infinity))
    .sort((a, b) => b.sequence - a.sequence);
  const baseline =
    history.find((entry) => entry.id === compareId) ??
    (selected?.supersedes
      ? history.find((entry) => entry.id === selected.supersedes)
      : null) ??
    compareCandidates[0] ??
    null;

  const diff =
    selected && baseline ? diffReleases(baseline, selected) : null;
  const currentFingerprint = releaseFingerprint(state);

  const forkDraft = (entry: ReleaseRecord) => {
    const result = restoreDraftFromRelease(entry.id);
    if (!result.ok) {
      setNotice(result.message ?? "The review draft could not be created.");
      return;
    }
    setNotice(
      `A new review draft was seeded from v${entry.sequence}. History is unchanged; re-run the readiness check to publish a new version.`,
    );
  };

  return (
    <Modal
      eyebrow="RELEASE LINEAGE"
      title="Release history"
      onClose={onClose}
      footer={
        <span className="release-history-footnote">
          <Lock size={14} /> Versions are frozen evidence. Viewing or forking
          them never changes history or the publishable release.
        </span>
      }
    >
      <div className="release-history-layout">
        <div className="release-version-list" aria-label="Checked versions">
          {history.length === 0 && (
            <p className="release-empty">
              No readiness checks have been run yet. Each check freezes a
              version here.
            </p>
          )}
          {history.map((entry) => {
            const view = describeReleaseStatus(
              entry,
              state.releaseHistory,
              currentFingerprint,
            );
            const isSelected = entry.id === selectedId;
            return (
              <button
                key={entry.id}
                type="button"
                className={`release-version-row ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  setSelectedId(entry.id);
                  setCompareId(null);
                  setNotice(null);
                }}
              >
                <div className="release-version-head">
                  <VersionLabel sequence={entry.sequence} />
                  <Badge tone={STATUS_TONE[view.status]}>{view.label}</Badge>
                </div>
                <div className="release-version-meta">
                  {entry.readiness.ready ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <XCircle size={13} />
                  )}
                  Score {entry.readiness.score} · {formatDate(entry.createdAt)}
                </div>
                <div className="release-version-line">
                  {entry.supersedes ? (
                    <>
                      <GitBranch size={12} /> Supersedes{" "}
                      v
                      {state.releaseHistory.find(
                        (candidate) => candidate.id === entry.supersedes,
                      )?.sequence ?? "?"}
                    </>
                  ) : (
                    <>
                      <Clock3 size={12} /> First recorded check
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div className="release-detail">
          {!selected ? (
            <p className="release-empty">Select a version to inspect.</p>
          ) : (
            <ReleaseDetail
              state={state}
              entry={selected}
              statusView={describeReleaseStatus(
                selected,
                state.releaseHistory,
                currentFingerprint,
              )}
              baseline={baseline}
              compareCandidates={compareCandidates}
              onSelectCompare={setCompareId}
              diff={diff}
              onFork={forkDraft}
            />
          )}
          {notice && (
            <Callout tone="info" title="Draft workspace updated">
              {notice}
            </Callout>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReleaseDetail({
  state,
  entry,
  statusView,
  baseline,
  compareCandidates,
  onSelectCompare,
  diff,
  onFork,
}: {
  state: StudyState;
  entry: ReleaseRecord;
  statusView: ReturnType<typeof describeReleaseStatus>;
  baseline: ReleaseRecord | null;
  compareCandidates: ReleaseRecord[];
  onSelectCompare: (id: string | null) => void;
  diff: ReleaseDiff | null;
  onFork: (entry: ReleaseRecord) => void;
}) {
  const forkable = canForkDraft(entry);
  const unresolved = entry.content
    ? entry.content.issues.filter((issue) => issue.status !== "resolved")
    : entry.snapshot?.unresolvedIssues ?? [];
  const routeSeconds = entry.content
    ? entry.content.sites.reduce(
        (sum, site) =>
          sum +
          site.recordingIds.reduce((siteSum, id) => {
            const clip = entry.content?.recordings.find(
              (recording) => recording.id === id,
            );
            return siteSum + (clip?.audioSpec.durationSeconds ?? 0);
          }, 0),
        0,
      )
    : entry.snapshot?.summary.routeSeconds;
  return (
    <div className="release-detail-stack">
      <div className="release-detail-head">
        <div>
          <div className="release-detail-title">
            <VersionLabel sequence={entry.sequence} />
            <Badge tone={STATUS_TONE[statusView.status]}>
              {statusView.label}
            </Badge>
          </div>
          <p>{statusView.detail}</p>
          <p className="release-detail-sub">
            Checked {formatDate(entry.createdAt)} · frozen at revision{" "}
            {entry.revision} · fingerprint{" "}
            <code>{entry.fingerprint.slice(-8)}</code>
          </p>
        </div>
        <div className="release-detail-actions">
          <Button
            variant="primary"
            icon={<RotateCcw size={15} />}
            disabled={!forkable}
            title={
              forkable
                ? "Copy this version into a new editable review draft"
                : "This legacy version has no frozen content to restore"
            }
            onClick={() => onFork(entry)}
          >
            Start draft from this version
          </Button>
        </div>
      </div>

      {entry.readiness.ready ? (
        <Callout tone="success" title="This check passed the release gate">
          {entry.status === "ready"
            ? "It froze a publishable snapshot at check time. Publishing still requires the current workspace to match it."
            : "It froze an approved snapshot, but the workspace has since moved on."}
        </Callout>
      ) : (
        <Callout tone="danger" title="This check was blocked">
          No snapshot was published. Blocking conditions at check time:
          <ul className="release-blocker-list">
            {entry.readiness.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="release-stat-grid">
        <ReleaseStat
          label="Clips"
          value={String(entry.content?.recordings.length ?? entry.snapshot?.summary.recordingCount ?? "—")}
        />
        <ReleaseStat
          label="Sites"
          value={String(entry.content?.sites.length ?? entry.snapshot?.summary.siteCount ?? "—")}
        />
        <ReleaseStat
          label="Open findings"
          value={String(unresolved.length)}
          tone={unresolved.length ? "warning" : "positive"}
        />
        <ReleaseStat
          label="Route length"
          value={routeSeconds !== undefined ? formatMinutes(routeSeconds / 60) : "—"}
        />
      </div>

      {unresolved.length > 0 && (
        <div className="release-evidence">
          <div className="eyebrow">UNRESOLVED EVIDENCE AT CHECK TIME</div>
          <ul>
            {unresolved.map((issue) => (
              <li key={issue.id}>
                {issue.severity === "critical" ? (
                  <ShieldAlert size={13} />
                ) : issue.severity === "warning" ? (
                  <FileWarning size={13} />
                ) : (
                  <Clock3 size={13} />
                )}
                <span>
                  <strong>{issue.title}</strong> · {titleCase(issue.status)} ·{" "}
                  {issue.owner}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="release-compare">
        <div className="release-compare-head">
          <div>
            <div className="eyebrow">IMPACT COMPARED WITH</div>
            <strong>
              <VersionLabel sequence={entry.sequence} /> compared to an earlier
              version
            </strong>
          </div>
          <label className="release-compare-select">
            <span>Baseline</span>
            <select
              value={baseline?.id ?? ""}
              onChange={(event) => onSelectCompare(event.target.value || null)}
            >
              {compareCandidates.length === 0 && (
                <option value="">No earlier version</option>
              )}
              {compareCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  v{candidate.sequence} · {formatDate(candidate.createdAt)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!baseline && (
          <p className="release-empty">
            This is the earliest recorded version; nothing precedes it.
          </p>
        )}
        {baseline && !diff && (
          <p className="release-empty">
            One of these versions predates frozen content, so its impact cannot
            be reconstructed.
          </p>
        )}
        {diff && <ReleaseImpact diff={diff} state={state} />}
      </div>
    </div>
  );
}

function ReleaseStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "warning";
}) {
  return (
    <div className={`release-stat ${tone ? `release-stat-${tone}` : ""}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Delta({ from, to, suffix = "" }: { from: number; to: number; suffix?: string }) {
  const change = to - from;
  if (change === 0)
    return (
      <span className="release-delta release-delta-same">
        {to}
        {suffix} <Minus size={12} />
      </span>
    );
  const positive = change > 0;
  return (
    <span
      className={`release-delta ${positive ? "release-delta-up" : "release-delta-down"}`}
    >
      {from}
      {suffix}
      <ArrowRight size={12} />
      {to}
      {suffix}
      {positive ? <Plus size={12} /> : <Minus size={12} />}
      {Math.abs(change)}
      {suffix}
    </span>
  );
}

function ReleaseImpact({
  diff,
  state,
}: {
  diff: ReleaseDiff;
  state: StudyState;
}) {
  const recordingCount = diff.recordings.length;
  const siteCount = diff.sites.length;
  const issueCount = diff.issues.length;
  const siteName = (siteId: string) =>
    state.sites.find((site) => site.id === siteId)?.name ??
    diff.to.content?.sites.find((site) => site.id === siteId)?.name ??
    diff.from.content?.sites.find((site) => site.id === siteId)?.name ??
    siteId;
  return (
    <div className="release-impact">
      <div className="release-impact-totals">
        <span>
          Clips <Delta from={diff.totals.recordingCount.from} to={diff.totals.recordingCount.to} />
        </span>
        <span>
          Sites <Delta from={diff.totals.siteCount.from} to={diff.totals.siteCount.to} />
        </span>
        <span>
          Open findings <Delta from={diff.totals.openIssues.from} to={diff.totals.openIssues.to} />
        </span>
        <span>
          Route minutes{" "}
          <Delta
            from={Math.round(diff.totals.routeSeconds.from / 60)}
            to={Math.round(diff.totals.routeSeconds.to / 60)}
          />
        </span>
        <span>
          Readiness <Delta from={diff.totals.readinessScore.from} to={diff.totals.readinessScore.to} />
        </span>
      </div>
      {!diff.hasChanges && (
        <p className="release-empty">
          Recordings, sites, and findings were identical across these versions;
          only the check itself changed.
        </p>
      )}
      {recordingCount > 0 && (
        <ImpactGroup
          icon={<FileWarning size={14} />}
          title={`Recordings (${recordingCount})`}
        >
          {diff.recordings.map((change) => (
            <RecordingImpactRow key={change.recordingId} change={change} />
          ))}
        </ImpactGroup>
      )}
      {siteCount > 0 && (
        <ImpactGroup icon={<GitBranch size={14} />} title={`Sites & route (${siteCount})`}>
          {diff.sites.map((change) => (
            <SiteImpactRow key={change.siteId} change={change} siteName={siteName(change.siteId)} />
          ))}
        </ImpactGroup>
      )}
      {issueCount > 0 && (
        <ImpactGroup
          icon={<ShieldAlert size={14} />}
          title={`Quality findings (${issueCount})`}
        >
          {diff.issues.map((change) => (
            <IssueImpactRow key={change.issueId} change={change} />
          ))}
        </ImpactGroup>
      )}
    </div>
  );
}

function ImpactGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="impact-group">
      <h4>
        {icon} {title}
      </h4>
      <ul>{children}</ul>
    </section>
  );
}

function KindBadge({ kind }: { kind: "added" | "removed" | "changed" }) {
  if (kind === "added")
    return (
      <Badge tone="positive">
        <Plus size={12} /> Added
      </Badge>
    );
  if (kind === "removed")
    return (
      <Badge tone="danger">
        <Minus size={12} /> Removed
      </Badge>
    );
  return <Badge tone="info">Changed</Badge>;
}

function RecordingImpactRow({ change }: { change: RecordingChange }) {
  return (
    <li className="impact-row">
      <div className="impact-row-head">
        <strong>
          {change.title} <small>{change.catalogId}</small>
        </strong>
        <KindBadge kind={change.kind} />
      </div>
      {change.placementChanged && (
        <div className="impact-line">
          Placement: <span className="impact-from">{change.placementFrom}</span>{" "}
          <ArrowRight size={12} />{" "}
          <span className="impact-to">{change.placementTo}</span>
        </div>
      )}
      {change.fields.map((field) => (
        <div className="impact-line" key={field.field}>
          {field.field}: <span className="impact-from">{field.from}</span>{" "}
          <ArrowRight size={12} /> <span className="impact-to">{field.to}</span>
        </div>
      ))}
    </li>
  );
}

function SiteImpactRow({
  change,
  siteName,
}: {
  change: SiteChange;
  siteName: string;
}) {
  return (
    <li className="impact-row">
      <div className="impact-row-head">
        <strong>{change.kind === "removed" ? siteName : change.name}</strong>
        <KindBadge kind={change.kind} />
      </div>
      {change.fields.map((field) => (
        <div className="impact-line" key={field.field}>
          {field.field}: <span className="impact-from">{field.from}</span>{" "}
          <ArrowRight size={12} /> <span className="impact-to">{field.to}</span>
        </div>
      ))}
      {change.clipsAdded.length > 0 && (
        <div className="impact-line">
          Clips added: {change.clipsAdded.map((clip) => clip.title).join(", ")}
        </div>
      )}
      {change.clipsRemoved.length > 0 && (
        <div className="impact-line">
          Clips removed:{" "}
          {change.clipsRemoved.map((clip) => clip.title).join(", ")}
        </div>
      )}
      {change.reordered && <div className="impact-line">Clip order changed</div>}
    </li>
  );
}

function IssueImpactRow({ change }: { change: IssueChange }) {
  return (
    <li className="impact-row">
      <div className="impact-row-head">
        <strong>{change.title}</strong>
        <KindBadge kind={change.kind} />
      </div>
      {change.fields.map((field) => (
        <div className="impact-line" key={field.field}>
          {field.field}: <span className="impact-from">{field.from}</span>{" "}
          <ArrowRight size={12} /> <span className="impact-to">{field.to}</span>
        </div>
      ))}
    </li>
  );
}
