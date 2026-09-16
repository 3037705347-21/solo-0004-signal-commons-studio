import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  GripVertical,
  Lightbulb,
  Minus,
  Plus,
  Route,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { RecordingGlyph } from "../../components/RecordingGlyph";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Metric } from "../../components/Metric";
import { ProgressBar } from "../../components/ProgressBar";
import { SectionHeader } from "../../components/SectionHeader";
import {
  analyzeRoute,
  canPlaceRecording,
  getUnplacedRecordings,
} from "../../domain/routeAnalysis";
import {
  formatMinutes,
  formatPercent,
  titleCase,
} from "../../domain/formatters";
import type { Recording, Site } from "../../domain/models";
import { selectActiveRuleVersion } from "../../domain/rules";
import { useStudy } from "../../state/StudyContext";

export function RoutePage() {
  const { state, assignRecording, removePlacement, reorderRecording } =
    useStudy();
  const [selectedRecording, setSelectedRecording] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const activeRules = selectActiveRuleVersion(state).rules;
  const analysis = useMemo(
    () => analyzeRoute(state.recordings, state.sites, activeRules),
    [state.recordings, state.sites, activeRules],
  );
  const unplaced = getUnplacedRecordings(state.recordings, state.sites);
  const place = (recording: Recording, site: Site) => {
    const recordingById = new Map(
      state.recordings.map((candidate) => [candidate.id, candidate]),
    );
    const currentClips = site.recordingIds
      .filter((id) => id !== recording.id)
      .map((id) => recordingById.get(id))
      .filter((candidate): candidate is Recording => Boolean(candidate));
    const preview = canPlaceRecording(
      recording,
      site,
      currentClips,
      activeRules,
    );
    if (preview.some((finding) => finding.type === "error")) {
      setNotice(preview[0].detail);
      window.setTimeout(() => setNotice(null), 2800);
      return;
    }
    const result = assignRecording(recording.id, site.id);
    if (!result.ok) {
      setNotice(result.message ?? "Placement failed.");
      window.setTimeout(() => setNotice(null), 2800);
    }
    setSelectedRecording(null);
  };
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="LISTENING ROUTE"
        title="Listening route"
        description="Arrange the sequence, then let the constraint engine challenge the soundscape."
        actions={
          <div className="inline-status">
            <Route size={16} />
            <span>
              {formatMinutes(analysis.totalDurationSeconds / 60)} planned
              listening
            </span>
          </div>
        }
      />
      <div className="metric-grid four">
        <Metric
          label="Placed clips"
          value={`${analysis.placedCount}/${state.recordings.length}`}
          detail={`${analysis.unplacedCount} unplaced`}
          icon={<Eye size={17} />}
          tone="teal"
        />
        <Metric
          label="Featured coverage"
          value={formatPercent(analysis.featuredCoverage)}
          detail="Required clips"
          icon={<ShieldCheck size={17} />}
          tone={analysis.featuredCoverage === 1 ? "teal" : "red"}
        />
        <Metric
          label="Role coverage"
          value={formatPercent(analysis.roleCoverage)}
          detail="Signal arc"
          icon={<Sparkles size={17} />}
          tone={analysis.roleCoverage === 1 ? "teal" : "amber"}
        />
        <Metric
          label="Constraints"
          value={`${analysis.blockingCount} errors`}
          detail={`${analysis.warningCount} warnings`}
          icon={<AlertTriangle size={17} />}
          tone={analysis.blockingCount ? "red" : "amber"}
        />
      </div>
      <div className="route-layout">
        <section className="route-board">
          <div className="board-header">
            <div>
              <div className="eyebrow">SEQUENCE BOARD</div>
              <h2>Listening flow</h2>
            </div>
            <div className="board-legend">
              <span>
                <i className="legend-dot legend-placed" /> placed
              </span>
              <span>
                <i className="legend-dot legend-issue" /> needs attention
              </span>
            </div>
          </div>
          <div className="site-list">
            {state.sites
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((site, index) => (
                <SiteLane
                  key={site.id}
                  site={site}
                  index={index}
                  recordings={state.recordings}
                  analysis={analysis.sites.find(
                    (item) => item.siteId === site.id,
                  )}
                  selectedRecording={selectedRecording}
                  onSelect={setSelectedRecording}
                  onPlace={place}
                  onRemove={removePlacement}
                  onReorder={reorderRecording}
                />
              ))}
          </div>
        </section>
        <aside className="route-sidebar">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">UNPLACED</div>
              <h3>Clip queue</h3>
            </div>
            <Badge tone={unplaced.length ? "warning" : "positive"}>
              {unplaced.length}
            </Badge>
          </div>
          {unplaced.length ? (
            <div className="unplaced-list">
              {unplaced.map((recording) => (
                <button
                  className={`unplaced-item ${selectedRecording === recording.id ? "selected" : ""}`}
                  key={recording.id}
                  onClick={() =>
                    setSelectedRecording(
                      selectedRecording === recording.id ? null : recording.id,
                    )
                  }
                >
                  <RecordingGlyph color={recording.color} size="small" />
                  <span>
                    <strong>{recording.title}</strong>
                    <small>
                      {recording.catalogId} · {titleCase(recording.signalRole)}
                    </small>
                  </span>
                  <Plus size={15} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={22} />}
              title="Queue is clear"
              detail="Every library clip has a place in the listening route."
            />
          )}
          <div className="constraint-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">ANALYSIS</div>
                <h3>Constraint review</h3>
              </div>
              <Badge tone={analysis.blockingCount ? "danger" : "positive"}>
                {analysis.blockingCount ? "Blocked" : "Clear"}
              </Badge>
            </div>
            {analysis.findings.length ? (
              <div className="finding-list compact">
                {analysis.findings.slice(0, 5).map((finding) => (
                  <div
                    className={`finding-row ${finding.type}`}
                    key={finding.id}
                  >
                    {finding.type === "error" ? (
                      <XCircle size={15} />
                    ) : finding.type === "warning" ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <Lightbulb size={15} />
                    )}
                    <span>
                      <strong>{finding.title}</strong>
                      <small>{finding.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="clear-message">
                <CheckCircle2 size={17} /> No constraints detected
              </div>
            )}
          </div>
        </aside>
      </div>
      {notice && (
        <div className="toast toast-warning">
          <AlertTriangle size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

function SiteLane({
  site,
  index,
  recordings,
  analysis,
  selectedRecording,
  onSelect,
  onPlace,
  onRemove,
  onReorder,
}: {
  site: Site;
  index: number;
  recordings: Recording[];
  analysis?: ReturnType<typeof analyzeRoute>["sites"][number];
  selectedRecording: string | null;
  onSelect?: (id: string | null) => void;
  onPlace: (recording: Recording, site: Site) => void;
  onRemove: (id: string) => void;
  onReorder: (siteId: string, recordingId: string, direction: -1 | 1) => void;
}) {
  void onSelect;
  const recordingMap = new Map(
    recordings.map((recording) => [recording.id, recording]),
  );
  const placed = site.recordingIds
    .map((id) => recordingMap.get(id))
    .filter((recording): recording is Recording => Boolean(recording));
  const selected = selectedRecording
    ? recordingMap.get(selectedRecording)
    : undefined;
  const issueCount =
    analysis?.findings.filter((finding) => finding.type === "error").length ??
    0;
  return (
    <article className="site-lane">
      <div className="site-marker" style={{ backgroundColor: site.color }}>
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="site-content">
        <div className="site-head">
          <div>
            <div className="site-title-line">
              <h3>{site.name}</h3>
              {issueCount > 0 && (
                <Badge tone="danger">
                  {issueCount} issue{issueCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <p>{site.prompt}</p>
          </div>
          <div className="site-stats">
            <span>
              {placed.length}/{site.maxClips} clips
            </span>
            <span>
              {analysis?.durationSeconds ?? 0}/{site.maxDurationSeconds} sec
            </span>
          </div>
        </div>
        <ProgressBar
          value={(analysis?.utilization ?? 0) * 100}
          tone={
            issueCount
              ? "red"
              : (analysis?.utilization ?? 0) >= 0.8
                ? "amber"
                : "teal"
          }
        />
        <div className="site-flags">
          <span>{site.quietSpace ? "Quiet playback" : "Open soundscape"}</span>
          <span>
            {site.hasSeating ? "Seating available" : "Standing listening"}
          </span>
        </div>
        <div className="placement-list">
          {placed.map((recording, recordingIndex) => (
            <div className="placement-item" key={recording.id}>
              <GripVertical size={15} className="drag-handle" />
              <RecordingGlyph color={recording.color} size="small" />
              <div className="placement-info">
                <strong>{recording.title}</strong>
                <span>
                  {titleCase(recording.signalRole)} ·{" "}
                  {Math.round(recording.audioSpec.durationSeconds / 60)} min
                </span>
              </div>
              <div className="placement-actions">
                <Button
                  variant="ghost"
                  icon={<ArrowUp size={14} />}
                  aria-label={`Move ${recording.title} up`}
                  disabled={recordingIndex === 0}
                  onClick={() => onReorder(site.id, recording.id, -1)}
                />
                <Button
                  variant="ghost"
                  icon={<ArrowDown size={14} />}
                  aria-label={`Move ${recording.title} down`}
                  disabled={recordingIndex === placed.length - 1}
                  onClick={() => onReorder(site.id, recording.id, 1)}
                />
                <Button
                  variant="ghost"
                  icon={<Minus size={14} />}
                  aria-label={`Remove ${recording.title}`}
                  onClick={() => onRemove(recording.id)}
                />
              </div>
            </div>
          ))}
          {selected && !site.recordingIds.includes(selected.id) && (
            <button
              className="drop-target"
              onClick={() => onPlace(selected, site)}
            >
              <Plus size={15} /> Place <strong>{selected.title}</strong> here
            </button>
          )}
          {placed.length === 0 && !selected && (
            <div className="site-empty">
              Select a clip from the queue to place it here.
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
