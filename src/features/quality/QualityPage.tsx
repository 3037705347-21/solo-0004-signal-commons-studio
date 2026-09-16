import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileWarning,
  ListChecks,
  MapPin,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import { downloadTextFile } from "../../domain/export";
import { sortSites } from "../../domain/filters";
import { formatDate, formatMinutes, titleCase } from "../../domain/formatters";
import { analyzeRoute } from "../../domain/routeAnalysis";
import type {
  IssueDraft,
  IssueSeverity,
  IssueStatus,
  QualityIssue,
} from "../../domain/models";
import {
  evaluateRelease,
  isReleaseCurrent,
  liveRecordings,
  liveSites,
} from "../../domain/releaseRules";
import {
  buildSiteChecklist,
  serializeSiteChecklistCsv,
  siteChecklistFileName,
} from "../../domain/siteChecklist";
import {
  loadReviewUi,
  saveReviewUi,
  type ReviewUiState,
} from "../../state/persistence";
import { useStudy } from "../../state/StudyContext";

type StatusFilter = IssueStatus | "all";
const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "open",
  "in-progress",
  "resolved",
];

export function QualityPage() {
  const {
    state,
    addIssue,
    transitionQualityIssue,
    checkReadiness,
    createSnapshot,
  } = useStudy();
  const [reviewUi, setReviewUi] = useState<ReviewUiState>(() => loadReviewUi());
  const [showModal, setShowModal] = useState(false);
  const [readiness, setReadiness] = useState(() =>
    state.release?.readiness ??
      evaluateRelease(
        state,
        analyzeRoute(liveRecordings(state), liveSites(state)),
      ),
  );
  const [toast, setToast] = useState<string | null>(null);
  const releaseCurrent = isReleaseCurrent(state, state.release);
  const exportReady = readiness.ready && releaseCurrent;

  useEffect(() => {
    saveReviewUi(reviewUi);
  }, [reviewUi]);
  const setSiteId = (siteId: string) =>
    setReviewUi((ui) => ({ ...ui, siteId }));
  const setStatus = (status: StatusFilter) =>
    setReviewUi((ui) => ({ ...ui, status }));

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const sites = useMemo(() => sortSites(liveSites(state)), [state]);
  const selectedSite = sites.find((site) => site.id === reviewUi.siteId);
  const filter = reviewUi.status;

  const scopedIssues = useMemo<QualityIssue[]>(() => {
    const liveIssues = state.issues.filter(
      (issue) => issue.lifecycle?.state !== "archived",
    );
    if (!selectedSite) return liveIssues;
    return liveIssues.filter(
      (issue) =>
        issue.siteId === selectedSite.id ||
        (Boolean(issue.recordingId) &&
          selectedSite.recordingIds.includes(issue.recordingId as string)),
    );
  }, [state.issues, selectedSite]);

  const counts = {
    all: scopedIssues.length,
    open: scopedIssues.filter((issue) => issue.status === "open").length,
    "in-progress": scopedIssues.filter(
      (issue) => issue.status === "in-progress",
    ).length,
    resolved: scopedIssues.filter((issue) => issue.status === "resolved")
      .length,
  };
  const filtered = scopedIssues.filter(
    (issue) => filter === "all" || issue.status === filter,
  );
  const checklist = selectedSite
    ? buildSiteChecklist(state, selectedSite.id)
    : null;

  const runCheck = () => setReadiness(checkReadiness());
  const exportSnapshot = () => {
    const result = createSnapshot();
    if (!result.ok || !result.value) {
      notify(result.message ?? "Resolve blockers before exporting.");
      return;
    }
    downloadTextFile(
      JSON.stringify(result.value, null, 2),
      `signal-commons-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
    );
    notify("Snapshot downloaded.");
  };
  const exportChecklist = () => {
    if (!selectedSite || !checklist) return;
    downloadTextFile(
      serializeSiteChecklistCsv(checklist),
      siteChecklistFileName(selectedSite),
      "text/csv;charset=utf-8",
    );
    notify("Site checklist downloaded.");
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="QUALITY GATE"
        title="Review desk"
        description="Turn open questions into resolved decisions, then run the final readiness check."
        actions={
          <div className="header-button-row">
            <Button
              variant="secondary"
              icon={<ClipboardCheck size={16} />}
              onClick={runCheck}
            >
              Run readiness check
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={17} />}
              onClick={() => setShowModal(true)}
            >
              New finding
            </Button>
          </div>
        }
      />
      <section
        className={`readiness-card ${exportReady ? "ready" : "blocked"}`}
      >
        <div className="readiness-icon">
          {exportReady ? (
            <CheckCircle2 size={28} />
          ) : (
            <ShieldAlert size={28} />
          )}
        </div>
        <div className="readiness-copy">
          <div className="eyebrow">
            READINESS CHECK ·{" "}
            {readiness.checkedAt ? formatDate(readiness.checkedAt) : "not run"}
          </div>
          <h2>
            {exportReady ? "Ready to share" : "Still needs attention"}
          </h2>
          <p>
            {exportReady
              ? "The route and review desk have no blocking conditions."
              : readiness.ready
                ? "The study changed after the last successful check. Run it again before exporting."
                : `${readiness.blockers.length} blocking condition${readiness.blockers.length === 1 ? "" : "s"} prevent this plan from being marked ready.`}
          </p>
        </div>
        <div className="readiness-score">
          <strong>{readiness.score}</strong>
          <span>readiness score</span>
        </div>
        <div className="readiness-actions">
          {exportReady ? (
            <Button
              variant="primary"
              icon={<Download size={16} />}
              onClick={exportSnapshot}
            >
              Export snapshot
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon={<RotateCcw size={16} />}
              onClick={runCheck}
            >
              Re-check plan
            </Button>
          )}
        </div>
      </section>
      {!exportReady && (
        <section className="blocker-list">
          <div className="eyebrow">WHAT IS BLOCKING</div>
          {(readiness.blockers.length
            ? readiness.blockers
            : ["Re-run the readiness check for the current study revision."]
          ).map((blocker) => (
            <div className="blocker-row" key={blocker}>
              <XCircle size={16} />
              <span>{blocker}</span>
            </div>
          ))}
        </section>
      )}
      <div className="review-summary">
        <div>
          <span className="eyebrow">TOTAL FINDINGS</span>
          <strong>{counts.all}</strong>
        </div>
        <div>
          <span className="eyebrow">OPEN</span>
          <strong className="text-danger">{counts.open}</strong>
        </div>
        <div>
          <span className="eyebrow">IN PROGRESS</span>
          <strong className="text-amber">{counts["in-progress"]}</strong>
        </div>
        <div>
          <span className="eyebrow">RESOLVED</span>
          <strong className="text-teal">{counts.resolved}</strong>
        </div>
      </div>
      <div className="review-filters">
        <div className="review-site-field">
          <SelectField
            label="Listening site"
            value={selectedSite?.id ?? ""}
            onChange={(event) => setSiteId(event.target.value)}
          >
            <option value="">All sites — overview</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectField>
        </div>
        <span className="review-hint">
          <Sparkles size={14} />{" "}
          {selectedSite
            ? "Findings and the field checklist are scoped to this site."
            : "Critical findings block readiness"}
        </span>
      </div>
      <div className="review-toolbar">
        <div className="segmented-control">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              className={filter === status ? "selected" : ""}
              onClick={() => setStatus(status)}
            >
              {titleCase(status)} <span>{counts[status]}</span>
            </button>
          ))}
        </div>
      </div>
      {checklist && (
        <SiteChecklistCard checklist={checklist} onDownload={exportChecklist} />
      )}
      <section className="issue-list">
        {filtered.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            onTransition={(status) => transitionQualityIssue(issue.id, status)}
          />
        ))}
      </section>
      {filtered.length === 0 && (
        <EmptyState
          icon={<MapPin size={26} />}
          title={selectedSite ? "No findings in this site" : "No findings here"}
          detail={
            selectedSite
              ? "This site has no findings matching the current status filter."
              : "No findings match the current status filter."
          }
        />
      )}
      {showModal && (
        <IssueEditor
          state={state}
          onClose={() => setShowModal(false)}
          onSave={(draft) => {
            const result = addIssue(draft);
            if (result.ok) setShowModal(false);
            return result;
          }}
        />
      )}
      {toast && (
        <div className="toast toast-positive">
          <Download size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function SiteChecklistCard({
  checklist,
  onDownload,
}: {
  checklist: NonNullable<ReturnType<typeof buildSiteChecklist>>;
  onDownload: () => void;
}) {
  return (
    <section
      className="site-checklist-card"
      aria-label="Listening site checklist"
    >
      <div className="panel-heading">
        <div>
          <div className="eyebrow">FIELD RECORDING CHECKLIST</div>
          <h2>{checklist.siteName}</h2>
        </div>
        <Button
          variant="primary"
          icon={<Download size={16} />}
          onClick={onDownload}
        >
          Download site checklist (CSV)
        </Button>
      </div>
      <p className="site-checklist-thesis">{checklist.prompt}</p>
      <div className="site-checklist-stats">
        <div>
          <span className="eyebrow">CLIPS</span>
          <strong>{checklist.clipCount}</strong>
        </div>
        <div>
          <span className="eyebrow">TOTAL LISTENING</span>
          <strong>{formatMinutes(checklist.totalDurationSeconds / 60)}</strong>
        </div>
        <div>
          <span className="eyebrow">UNRESOLVED FINDINGS</span>
          <strong
            className={checklist.unresolvedCount ? "text-amber" : "text-teal"}
          >
            {checklist.unresolvedCount}
          </strong>
        </div>
      </div>
      {checklist.siteFindings.length > 0 && (
        <div className="checklist-site-findings">
          <div className="eyebrow">SITE-WIDE OPEN FINDINGS</div>
          {checklist.siteFindings.map((finding, index) => (
            <div
              className="checklist-site-finding"
              key={`${finding.title}-${index}`}
            >
              <ShieldAlert size={14} />
              <span>
                <strong>[{finding.severity.toUpperCase()}]</strong>{" "}
                {finding.title} <em>· {finding.owner}</em>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="checklist-preview">
        {checklist.entries.length === 0 && (
          <div className="site-empty">
            No clips are placed in this site yet.
          </div>
        )}
        {checklist.entries.map((entry) => {
          const recordingFindings = entry.unresolvedFindings.filter(
            (finding) => finding.scope === "recording",
          );
          return (
            <div className="checklist-preview-row" key={entry.recordingId}>
              <span className="checklist-sequence">{entry.sequence}</span>
              <span className="checklist-clip">
                <strong>{entry.title}</strong>
                <small>{entry.catalogId}</small>
              </span>
              <span className="checklist-duration">
                <Clock size={13} />
                {entry.durationSeconds} sec
              </span>
              <span
                className={`checklist-findings ${recordingFindings.length ? "is-open" : "is-clear"}`}
              >
                {recordingFindings.length ? (
                  <>
                    <AlertCircle size={13} />
                    {recordingFindings.length} open finding
                    {recordingFindings.length === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={13} />
                    Clear
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="checklist-footnote">
        <ListChecks size={14} />
        <span>
          The CSV lists each clip in visit sequence with duration time and every
          unresolved finding (site-wide findings are tagged <code>[site]</code>
          ).
        </span>
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  onTransition,
}: {
  issue: QualityIssue;
  onTransition: (status: QualityIssue["status"]) => {
    ok: boolean;
    message?: string;
  };
}) {
  const [error, setError] = useState<string | null>(null);
  const next =
    issue.status === "open"
      ? "in-progress"
      : issue.status === "in-progress"
        ? "resolved"
        : "in-progress";
  const resultLabel =
    issue.status === "open"
      ? "Start work"
      : issue.status === "in-progress"
        ? "Resolve"
        : "Reopen";
  const result = () => {
    const response = onTransition(next);
    if (!response.ok) {
      setError(response.message ?? "Transition failed.");
      window.setTimeout(() => setError(null), 2500);
    }
  };
  return (
    <article className={`issue-row issue-${issue.severity}`}>
      <div className="issue-severity">
        {issue.severity === "critical" ? (
          <ShieldAlert size={19} />
        ) : issue.severity === "warning" ? (
          <AlertCircle size={19} />
        ) : (
          <FileWarning size={19} />
        )}
      </div>
      <div className="issue-main">
        <div className="issue-title-line">
          <h3>{issue.title}</h3>
          <Badge
            tone={
              issue.status === "resolved"
                ? "positive"
                : issue.severity === "critical"
                  ? "danger"
                  : issue.severity === "warning"
                    ? "warning"
                    : "neutral"
            }
          >
            {titleCase(issue.status)}
          </Badge>
        </div>
        <p>{issue.description}</p>
        <div className="issue-meta">
          <span>
            <UserRound size={13} /> {issue.owner}
          </span>
          {issue.siteId && (
            <span>
              <MapPin size={13} /> Site linked
            </span>
          )}
          {issue.recordingId && <span>Clip linked</span>}
          <span>Updated {formatDate(issue.updatedAt)}</span>
        </div>
        {error && <div className="field-error">{error}</div>}
      </div>
      <Button
        variant={issue.status === "resolved" ? "ghost" : "secondary"}
        icon={
          issue.status === "resolved" ? (
            <RotateCcw size={15} />
          ) : (
            <Check size={15} />
          )
        }
        onClick={result}
      >
        {resultLabel}
      </Button>
    </article>
  );
}

function IssueEditor({
  state,
  onClose,
  onSave,
}: {
  state: ReturnType<typeof useStudy>["state"];
  onClose: () => void;
  onSave: (draft: IssueDraft) => {
    ok: boolean;
    errors?: Record<string, string>;
  };
}) {
  const [draft, setDraft] = useState<IssueDraft>({
    title: "",
    description: "",
    severity: "warning",
    owner: "",
    siteId: "",
    recordingId: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      eyebrow="NEW REVIEW FINDING"
      title="Capture an open question"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Send size={15} />}
            onClick={() => {
              const result = onSave(draft);
              if (!result.ok) setErrors(result.errors ?? {});
            }}
          >
            Create finding
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Finding title"
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          error={errors.title}
          placeholder="What needs a decision?"
        />
        <SelectField
          label="Severity"
          value={draft.severity}
          onChange={(event) =>
            update("severity", event.target.value as IssueSeverity)
          }
        >
          <option value="note">Note</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical blocker</option>
        </SelectField>
        <TextField
          label="Owner"
          value={draft.owner}
          onChange={(event) => update("owner", event.target.value)}
          error={errors.owner}
          placeholder="Team member"
        />
        <SelectField
          label="Linked site"
          value={draft.siteId}
          onChange={(event) => update("siteId", event.target.value)}
        >
          <option value="">No site link</option>
          {state.sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Linked clip"
          value={draft.recordingId}
          onChange={(event) => update("recordingId", event.target.value)}
        >
          <option value="">No clip link</option>
          {state.recordings.map((recording) => (
            <option key={recording.id} value={recording.id}>
              {recording.title}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Context and next step"
          textarea
          rows={5}
          value={draft.description}
          onChange={(event) => update("description", event.target.value)}
          error={errors.description}
          placeholder="Describe the decision, evidence, or next action."
        />
      </div>
    </Modal>
  );
}
