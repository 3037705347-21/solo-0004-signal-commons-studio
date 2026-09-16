import {
  Accessibility,
  ArrowRight,
  Gauge,
  Info,
  Layers3,
  Save,
  Users,
  WandSparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Donut } from "../../components/Donut";
import { Metric } from "../../components/Metric";
import { ProgressBar } from "../../components/ProgressBar";
import { SectionHeader } from "../../components/SectionHeader";
import { formatMinutes, titleCase } from "../../domain/formatters";
import { analyzeRoute } from "../../domain/routeAnalysis";
import { clampScenario, projectScenario } from "../../domain/scenario";
import type { RoutePreferences } from "../../domain/models";
import { useStudy } from "../../state/StudyContext";

export function ScenariosPage() {
  const { state, updatePreferences } = useStudy();
  const [draft, setDraft] = useState<RoutePreferences>(state.preferences);
  const [saved, setSaved] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const analysis = useMemo(
    () => analyzeRoute(state.recordings, state.sites),
    [state.recordings, state.sites],
  );
  const projection = useMemo(
    () => projectScenario(state, analysis, draft),
    [state, analysis, draft],
  );
  const setPreference = <K extends keyof RoutePreferences>(
    key: K,
    value: RoutePreferences[K],
  ) => setDraft((current) => clampScenario({ ...current, [key]: value }));
  const handoffPending = state.handoffs.some(
    (handoff) => handoff.status === "pending",
  );
  const apply = () => {
    const result = updatePreferences(draft);
    if (!result.ok) {
      setBlocked(result.message ?? "Planning preferences are locked.");
      window.setTimeout(() => setBlocked(null), 3600);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="SCENARIO LAB"
        title="Insights"
        description="Pressure-test the plan for different listener rhythms without changing the saved route."
        actions={
          <Button
            variant="primary"
            icon={<Save size={16} />}
            disabled={handoffPending}
            title={handoffPending ? "Locked while a handoff awaits confirmation." : undefined}
            onClick={apply}
          >
            Apply preferences
          </Button>
        }
      />
      <div className="scenario-banner">
        <div className="scenario-banner-icon">
          <WandSparkles size={21} />
        </div>
        <div>
          <strong>Scenario projection</strong>
          <p>
            Try a listener profile to see how pacing, group size, and access
            priorities reshape the listening route.
          </p>
        </div>
        <Badge tone="info">Non-destructive</Badge>
      </div>
      <div className="insights-layout">
        <section className="scenario-controls">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">INPUTS</div>
              <h2>Listener profile</h2>
            </div>
            <Users size={19} />
          </div>
          <div className="control-block">
            <label className="field-label">Listening pace</label>
            <div className="pace-options">
              {(["brief", "steady", "deep"] as const).map((pace) => (
                <button
                  key={pace}
                  className={draft.pace === pace ? "selected" : ""}
                  onClick={() => setPreference("pace", pace)}
                >
                  <span className="pace-dot" />
                  <strong>{titleCase(pace)}</strong>
                  <small>
                    {pace === "brief"
                      ? "Short route"
                      : pace === "steady"
                        ? "Recommended"
                        : "Deep listening"}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="control-block">
            <div className="control-label-row">
              <label className="field-label" htmlFor="group-size">
                Listener count
              </label>
              <strong>{draft.listenerCount} people</strong>
            </div>
            <input
              id="group-size"
              className="range-input"
              type="range"
              min="1"
              max="20"
              value={draft.listenerCount}
              onChange={(event) =>
                setPreference("listenerCount", Number(event.target.value))
              }
            />
            <div className="range-labels">
              <span>Solo</span>
              <span>Small group</span>
              <span>Large group</span>
            </div>
          </div>
          <div className="control-block">
            <div className="control-label-row">
              <label className="field-label" htmlFor="access-priority">
                Accessibility priority
              </label>
              <strong>{draft.accessPriority}%</strong>
            </div>
            <input
              id="access-priority"
              className="range-input teal"
              type="range"
              min="0"
              max="100"
              value={draft.accessPriority}
              onChange={(event) =>
                setPreference("accessPriority", Number(event.target.value))
              }
            />
            <div className="range-labels">
              <span>Baseline</span>
              <span>Prioritized</span>
              <span>Highest</span>
            </div>
          </div>
          <div className="saved-profile">
            <Info size={15} />
            <span>
              Saved profile:{" "}
              <strong>{titleCase(state.preferences.pace)}</strong> pace ·{" "}
              {state.preferences.listenerCount} people
            </span>
          </div>
        </section>
        <section className="projection-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">PROJECTED OUTCOME</div>
              <h2>{titleCase(draft.pace)} listening</h2>
            </div>
            <Badge
              tone={projection.comfortScore >= 75 ? "positive" : "warning"}
            >
              {projection.comfortScore >= 75
                ? "Comfortable"
                : "Pressure points"}
            </Badge>
          </div>
          <div className="projection-metrics">
            <Metric
              label="Listening duration"
              value={formatMinutes(projection.durationSeconds / 60)}
              detail="At this listener pace"
              icon={<Gauge size={17} />}
              tone="teal"
            />
            <Metric
              label="Comfort score"
              value={`${projection.comfortScore}/100`}
              detail="Density-adjusted"
              icon={<Users size={17} />}
              tone={projection.comfortScore >= 75 ? "teal" : "amber"}
            />
            <Metric
              label="Access coverage"
              value={`${projection.accessScore}/100`}
              detail="Interpretation access"
              icon={<Accessibility size={17} />}
              tone={projection.accessScore >= 75 ? "teal" : "amber"}
            />
          </div>
          <div className="donut-row">
            <Donut
              value={projection.continuityScore / 100}
              color="#c9563f"
              label="Continuity"
            />
            <Donut
              value={projection.accessScore / 100}
              color="#2f7c75"
              label="Access"
            />
            <Donut
              value={projection.comfortScore / 100}
              color="#7c6aa6"
              label="Comfort"
            />
          </div>
          <div className="recommendation-box">
            <div className="eyebrow">RECOMMENDATIONS</div>
            {projection.recommendations.map((recommendation) => (
              <div className="recommendation" key={recommendation}>
                <ArrowRight size={15} />
                <span>{recommendation}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="pressure-section">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SITE PRESSURE</div>
            <h2>Where the route is carrying weight</h2>
          </div>
          <Layers3 size={19} />
        </div>
        <div className="pressure-grid">
          {analysis.sites.map((site) => {
            const pressured = projection.pressureSiteIds.includes(site.siteId);
            const source = state.sites.find(
              (candidate) => candidate.id === site.siteId,
            );
            return (
              <div
                className={`pressure-card ${pressured ? "pressured" : ""}`}
                key={site.siteId}
              >
                <div className="pressure-card-top">
                  <span
                    className="site-color"
                    style={{ backgroundColor: source?.color }}
                  />
                  <strong>{source?.shortLabel}</strong>
                  {pressured && <Badge tone="warning">Pressure</Badge>}
                </div>
                <div className="pressure-stat">
                  <span>{site.clipCount} clips</span>
                  <strong>{formatMinutes(site.durationSeconds / 60)}</strong>
                </div>
                <ProgressBar
                  value={site.utilization * 100}
                  tone={pressured ? "amber" : "teal"}
                />
              </div>
            );
          })}
        </div>
      </section>
      {saved && (
        <div className="toast toast-positive">
          <Save size={16} />
          Planning preferences applied.
        </div>
      )}
      {blocked && (
        <div className="toast toast-warning">
          <Save size={16} />
          {blocked}
        </div>
      )}
    </div>
  );
}
