import {
  Archive,
  ArchiveRestore,
  DatabaseZap,
  Link2,
  ShieldQuestion,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Metric } from "../../components/Metric";
import { SectionHeader } from "../../components/SectionHeader";
import { formatDate } from "../../domain/formatters";
import type { RetentionCategory, StudyState } from "../../domain/models";
import {
  RETENTION_POLICY,
  buildRetentionReport,
  type RetentionStatus,
} from "../../domain/retention";
import {
  resolveRecording,
  resolveSite,
} from "../../domain/retentionRegistry";
import { useStudy } from "../../state/StudyContext";

type RecordKind = "recording" | "site" | "issue" | "batch";

export function RetentionPage() {
  const {
    state,
    archiveRecord,
    restoreRecord,
    purgeRecord,
    explainArchiveBlock,
    explainPurgeBlock,
    runRetentionSweep,
  } = useStudy();
  const [now] = useState(() => new Date());
  const [toast, setToast] = useState<string | null>(null);
  const report = useMemo(() => buildRetentionReport(state, now), [state, now]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const sweep = () => {
    const result = runRetentionSweep();
    notify(result.message ?? "Retention sweep complete.");
  };

  const totalExpired =
    report.summary.recordings.expired +
    report.summary.sites.expired +
    report.summary.issues.expired;
  const totalArchived =
    report.summary.recordings.archived +
    report.summary.sites.archived +
    report.summary.issues.archived;
  const cleanedReferences = state.sites.reduce(
    (count, site) =>
      count +
      site.recordingIds.filter((id) => {
        const resolved = resolveRecording(state, id);
        return resolved?.availability === "purged";
      }).length,
    0,
  );

  const act = (
    fn: () => { ok: boolean; message?: string },
    success: string,
  ) => {
    const result = fn();
    notify(result.ok ? success : (result.message ?? "Action unavailable."));
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="RETENTION & LINEAGE"
        title="Retention desk"
        description="Keep each business category inside its window, archive what is dormant, and clean expired material without breaking published versions, import batches, or route references."
        actions={
          <Button
            variant="primary"
            icon={<DatabaseZap size={16} />}
            onClick={sweep}
          >
            Run retention sweep
          </Button>
        }
      />
      <div className="metric-grid four">
        <Metric
          label="Within retention"
          value={String(
            report.summary.recordings.within +
              report.summary.sites.within +
              report.summary.issues.within,
          )}
          detail="Live records"
          icon={<ShieldQuestion size={17} />}
          tone="teal"
        />
        <Metric
          label="Expired — review"
          value={String(totalExpired)}
          detail="Eligible to archive"
          icon={<Archive size={17} />}
          tone="amber"
        />
        <Metric
          label="Archived"
          value={String(totalArchived)}
          detail="Restorable, not releasable"
          icon={<ArchiveRestore size={17} />}
          tone="red"
        />
        <Metric
          label="References to cleaned clips"
          value={String(cleanedReferences)}
          detail="Still resolvable"
          icon={<Link2 size={17} />}
          tone="default"
        />
      </div>

      <section className="retention-policy">
        <div className="eyebrow">EXECUTABLE POLICY</div>
        <div className="policy-grid">
          {(
            Object.entries(RETENTION_POLICY) as Array<
              [RetentionCategory, (typeof RETENTION_POLICY)[RetentionCategory]]
            >
          ).map(([category, policy]) => (
            <div className="policy-card" key={category}>
              <strong>{policy.label}</strong>
              <Badge tone="info">{policy.retentionDays} days</Badge>
              <p>{policy.description}</p>
            </div>
          ))}
        </div>
      </section>

      <RetentionSection
        title="Library clips"
        kind="recording"
        state={state}
        rows={report.recordings.map((entry) => ({
          id: entry.id,
          label: entry.title,
          status: entry.status,
        }))}
        onArchive={(id) =>
          act(() => archiveRecord("recording", id), "Clip archived.")
        }
        onRestore={(id) =>
          act(
            () => restoreRecord("recording", id),
            "Clip restored; it must pass a fresh readiness check before release.",
          )
        }
        onPurge={(id) =>
          act(() => purgeRecord("recording", id), "Clip cleaned; references remain resolvable.")
        }
        archiveBlock={(id) => explainArchiveBlock("recording", id)}
        purgeBlock={(id) => explainPurgeBlock("recording", id)}
      />

      <RetentionSection
        title="Listening sites"
        kind="site"
        state={state}
        rows={report.sites.map((entry) => ({
          id: entry.id,
          label: entry.name,
          status: entry.status,
        }))}
        onArchive={(id) => act(() => archiveRecord("site", id), "Site archived.")}
        onRestore={(id) =>
          act(
            () => restoreRecord("site", id),
            "Site restored; it must be re-reviewed before release.",
          )
        }
        onPurge={(id) =>
          act(() => purgeRecord("site", id), "Site cleaned; linked findings are retained.")
        }
        archiveBlock={(id) => explainArchiveBlock("site", id)}
        purgeBlock={(id) => explainPurgeBlock("site", id)}
      />

      <RetentionSection
        title="Quality findings"
        kind="issue"
        state={state}
        rows={report.issues.map((entry) => ({
          id: entry.id,
          label: entry.title,
          status: entry.status,
        }))}
        onArchive={(id) => act(() => archiveRecord("issue", id), "Finding archived.")}
        onRestore={(id) =>
          act(() => restoreRecord("issue", id), "Finding restored.")
        }
        onPurge={(id) => act(() => purgeRecord("issue", id), "Finding cleaned.")}
        archiveBlock={(id) => explainArchiveBlock("issue", id)}
        purgeBlock={(id) => explainPurgeBlock("issue", id)}
      />

      <ImportBatchSection />

      <LineageSection state={state} now={now} />

      {toast && <div className="toast toast-positive">{toast}</div>}
    </div>
  );
}

function RetentionStateBadge({ status }: { status: RetentionStatus }) {
  if (status.state === "archived")
    return <Badge tone="warning">Archived</Badge>;
  if (status.state === "expired")
    return <Badge tone="danger">Expired · {Math.abs(status.daysRemaining)}d overdue</Badge>;
  return <Badge tone="positive">{status.daysRemaining}d left</Badge>;
}

interface RetentionRow {
  id: string;
  label: string;
  status: RetentionStatus;
}

function RetentionSection({
  title,
  kind,
  rows,
  state,
  onArchive,
  onRestore,
  onPurge,
  archiveBlock,
  purgeBlock,
}: {
  title: string;
  kind: RecordKind;
  state: StudyState;
  rows: RetentionRow[];
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  archiveBlock: (id: string) => string | null;
  purgeBlock: (id: string) => string | null;
}) {
  const [filter, setFilter] = useState<"all" | RetentionStatus["state"]>("all");
  const visible = rows.filter(
    (row) => filter === "all" || row.status.state === filter,
  );
  return (
    <section className="retention-section">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">{kind.toUpperCase()}</div>
          <h2>{title}</h2>
        </div>
        <div className="segmented-control">
          {(["all", "within-retention", "expired", "archived"] as const).map(
            (value) => (
              <button
                key={value}
                className={filter === value ? "selected" : ""}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "All"
                  : value === "within-retention"
                    ? "Within"
                    : value[0].toUpperCase() + value.slice(1)}
              </button>
            ),
          )}
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Archive size={22} />}
          title="Nothing in this view"
          detail="No records match the selected lifecycle state."
        />
      ) : (
        <div className="retention-table">
          {visible.map((row) => {
            const archived = row.status.state === "archived";
            const blockArchive = archiveBlock(row.id);
            const blockPurge = purgeBlock(row.id);
            const references = describeReferences(kind, row.id, state);
            return (
              <div className="retention-row" key={row.id}>
                <div className="retention-row-main">
                  <strong>{row.label}</strong>
                  <span className="retention-meta">
                    {RETENTION_POLICY[row.status.category].label} · window ends{" "}
                    {formatDate(row.status.expiresAt)}
                    {references && (
                      <em className="retention-refs"> · {references}</em>
                    )}
                  </span>
                </div>
                <RetentionStateBadge status={row.status} />
                <div className="retention-actions">
                  {archived ? (
                    <>
                      <Button
                        variant="secondary"
                        icon={<ArchiveRestore size={14} />}
                        onClick={() => onRestore(row.id)}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<Trash2 size={14} />}
                        disabled={Boolean(blockPurge)}
                        title={blockPurge ?? "Clean this record"}
                        onClick={() => onPurge(row.id)}
                      >
                        Clean
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      icon={<Archive size={14} />}
                      disabled={Boolean(blockArchive)}
                      title={blockArchive ?? "Archive this record"}
                      onClick={() => onArchive(row.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function describeReferences(
  kind: RecordKind,
  id: string,
  state: StudyState,
): string | null {
  if (kind === "recording") {
    const resolved = resolveRecording(state, id);
    if (resolved?.availability === "purged")
      return `cleaned · cited by ${resolved.stub?.tombstone?.referencedByReleaseIds.length ?? 0} release version(s)`;
    const sitesUsing = state.sites.filter((site) =>
      site.recordingIds.includes(id),
    );
    return sitesUsing.length
      ? `on ${sitesUsing.length} active site list(s)`
      : null;
  }
  if (kind === "site") {
    const resolved = resolveSite(state, id);
    if (resolved?.availability === "purged")
      return `cleaned · ${state.issues.filter((issue) => issue.siteId === id).length} retained finding(s)`;
    const findings = state.issues.filter((issue) => issue.siteId === id).length;
    return findings ? `${findings} linked finding(s)` : null;
  }
  if (kind === "issue") {
    const issue = state.issues.find((item) => item.id === id);
    if (!issue) return null;
    if (issue.siteId) {
      const site = resolveSite(state, issue.siteId);
      if (site?.availability === "purged") return "points to a cleaned site";
    }
    if (issue.recordingId) {
      const clip = resolveRecording(state, issue.recordingId);
      if (clip?.availability === "purged") return "points to a cleaned clip";
    }
  }
  return null;
}

function ImportBatchSection() {
  const { state, archiveRecord, restoreRecord } = useStudy();
  return (
    <section className="retention-section">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">IMPORT BATCHES</div>
          <h2>Intake lineage</h2>
        </div>
      </div>
      <p className="retention-intro">
        Batch manifests outlive their clips: a cleaned clip’s id still appears in
        the batch that delivered it.
      </p>
      <div className="retention-table">
        {state.importBatches.map((batch) => {
          const archived = Boolean(batch.archivedAt);
          const surviving = batch.recordingIds.filter((id) =>
            state.recordings.some((recording) => recording.id === id),
          ).length;
          const cleaned = batch.recordingIds.length - surviving;
          return (
            <div className="retention-row" key={batch.id}>
              <div className="retention-row-main">
                <strong>{batch.label}</strong>
                <span className="retention-meta">
                  {batch.source} · imported {formatDate(batch.importedAt)} ·{" "}
                  {surviving} clip(s) live
                  {cleaned > 0 && (
                    <em className="retention-refs"> · {cleaned} cleaned but listed</em>
                  )}
                  {batch.note ? ` — ${batch.note}` : ""}
                </span>
              </div>
              {archived ? (
                <Badge tone="warning">Archived batch</Badge>
              ) : (
                <Badge tone="neutral">{batch.recordingIds.length} imported</Badge>
              )}
              <div className="retention-actions">
                {archived ? (
                  <Button
                    variant="secondary"
                    icon={<ArchiveRestore size={14} />}
                    onClick={() =>
                      restoreRecord("import-batch", batch.id)
                    }
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    icon={<Archive size={14} />}
                    onClick={() => archiveRecord("import-batch", batch.id)}
                  >
                    Archive batch
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LineageSection({
  state,
  now,
}: {
  state: StudyState;
  now: Date;
}) {
  const releases = [
    ...(state.release ? [state.release] : []),
    ...(state.releaseHistory ?? []),
  ].filter((release, index, all) =>
    all.findIndex((item) => item.id === release.id) === index,
  );
  return (
    <section className="retention-section">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">PUBLISHED VERSIONS</div>
          <h2>Release lineage</h2>
        </div>
      </div>
      <p className="retention-intro">
        Frozen releases and their embedded snapshots are retained for three
        years, so older versions and every clip they cited keep resolving.
      </p>
      {releases.length === 0 ? (
        <EmptyState
          icon={<ShieldQuestion size={22} />}
          title="No release frozen yet"
          detail="Run a readiness check in the quality desk to freeze the first version."
        />
      ) : (
        <div className="retention-table">
          {releases
            .slice()
            .sort((left, right) => right.sequence - left.sequence)
            .map((release) => {
              const anchor = new Date(release.createdAt);
              const days = Math.ceil(
                (anchor.getTime() +
                  RETENTION_POLICY["published-release"].retentionDays *
                    86_400_000 -
                  now.getTime()) /
                  86_400_000,
              );
              return (
                <div className="retention-row" key={release.id}>
                  <div className="retention-row-main">
                    <strong>Release #{release.sequence}</strong>
                    <span className="retention-meta">
                      Frozen {formatDate(release.createdAt)}
                      {release.supersedes ? " · supersedes an earlier version" : ""}
                      {release.snapshot
                        ? ` · embeds ${release.snapshot.summary.recordingCount} clip(s)`
                        : " · no snapshot"}
                    </span>
                  </div>
                  <Badge tone={days > 0 ? "positive" : "danger"}>
                    {days > 0 ? `${days}d retained` : "past window"}
                  </Badge>
                  <Badge tone={release.status === "ready" ? "positive" : "neutral"}>
                    {release.status}
                  </Badge>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}
