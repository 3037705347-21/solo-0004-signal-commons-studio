import {
  AlertTriangle,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  UserX,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Metric } from "../../components/Metric";
import { SectionHeader } from "../../components/SectionHeader";
import {
  formatDayShort,
  formatPercent,
  formatTimeRange,
  formatWeekday,
} from "../../domain/formatters";
import { sortSites } from "../../domain/filters";
import type {
  AssignmentDraft,
  MemberDraft,
  ScheduleAssignment,
  Site,
  TeamMember,
} from "../../domain/models";
import { analyzeSchedule, planDates } from "../../domain/schedule";
import { useStudy } from "../../state/StudyContext";
import { AssignmentEditor } from "./AssignmentEditor";
import { MemberEditor } from "./MemberEditor";

type EditorState =
  | { kind: "none" }
  | { kind: "member"; member?: TeamMember }
  | {
      kind: "assignment";
      assignment?: ScheduleAssignment;
      defaultSiteId?: string;
      defaultDate?: string;
    };

export function SchedulePage() {
  const {
    state,
    setScheduleWeekend,
    upsertMember,
    removeMember,
    upsertAssignment,
    removeAssignment,
  } = useStudy();
  const { schedule } = state;
  const [editor, setEditor] = useState<EditorState>({ kind: "none" });
  const [toast, setToast] = useState<string | null>(null);
  const sites = useMemo(() => sortSites(state.sites), [state.sites]);
  const analysis = useMemo(
    () => analyzeSchedule(schedule, state.sites),
    [schedule, state.sites],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const saveWeekend = (nextStart: string, nextEnd: string) => {
    const result = setScheduleWeekend(nextStart, nextEnd);
    if (!result.ok) notify(result.message ?? "Weekend dates could not be saved.");
  };

  const saveMember = (draft: MemberDraft, existing?: TeamMember) => {
    const result = upsertMember(draft, existing);
    if (result.ok) {
      setEditor({ kind: "none" });
      notify(existing ? "Colleague updated." : "Colleague added to the roster.");
    }
    return result;
  };

  const saveAssignment = (
    draft: AssignmentDraft,
    existing?: ScheduleAssignment,
  ) => {
    const result = upsertAssignment(draft, existing);
    if (result.ok) {
      setEditor({ kind: "none" });
      notify(existing ? "Shift updated." : "Shift added to the field plan.");
    }
    return result;
  };

  const dates = planDates(schedule);
  const absentAssignments = analysis.assignments.filter(
    (assignment) => assignment.status === "absent",
  );
  const sortedAssignments = analysis.assignments
    .slice()
    .sort((left, right) =>
      left.date === right.date
        ? left.startsAt.localeCompare(right.startsAt) ||
          left.siteShortLabel.localeCompare(right.siteShortLabel)
        : left.date.localeCompare(right.date),
    );

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="FIELD SCHEDULE"
        title="Weekend site coverage"
        description="Plan who covers each listening site and when. Gaps and double bookings update as soon as the plan changes."
        actions={
          <div className="header-button-row">
            <Button
              variant="secondary"
              icon={<UserPlus size={16} />}
              onClick={() => setEditor({ kind: "member" })}
            >
              Add colleague
            </Button>
            <Button
              variant="primary"
              icon={<CalendarPlus size={16} />}
              onClick={() => setEditor({ kind: "assignment" })}
              disabled={schedule.members.length === 0}
            >
              Add shift
            </Button>
          </div>
        }
      />

      <section className="weekend-bar">
        <div className="weekend-bar-icon">
          <CalendarRange size={20} />
        </div>
        <div className="weekend-fields">
          <label className="field">
            <span className="field-label">Weekend start</span>
            <input
              aria-label="Weekend start date"
              type="date"
              value={schedule.weekendStart}
              max={schedule.weekendEnd}
              onChange={(event) =>
                saveWeekend(event.target.value, schedule.weekendEnd)
              }
            />
          </label>
          <span className="weekend-separator">→</span>
          <label className="field">
            <span className="field-label">Weekend end</span>
            <input
              aria-label="Weekend end date"
              type="date"
              value={schedule.weekendEnd}
              min={schedule.weekendStart}
              onChange={(event) =>
                saveWeekend(schedule.weekendStart, event.target.value)
              }
            />
          </label>
        </div>
        <p className="weekend-note">
          Coverage is always calculated from these dates; recordings and
          published releases are never rewritten by schedule edits.
        </p>
      </section>

      <div className="metric-grid four">
        <Metric
          label="Site coverage"
          value={formatPercent(analysis.coverageRatio)}
          detail={`${analysis.coveredCells}/${analysis.totalCells} day-site slots`}
          icon={<MapPin size={17} />}
          tone={analysis.coverageRatio === 1 ? "teal" : "amber"}
        />
        <Metric
          label="Uncovered slots"
          value={String(analysis.uncoveredCells.length)}
          detail="Need a named colleague"
          icon={<UserX size={17} />}
          tone={analysis.uncoveredCells.length ? "red" : "teal"}
        />
        <Metric
          label="Overlapping shifts"
          value={String(analysis.conflicts.length)}
          detail="Colleagues double-booked"
          icon={<AlertTriangle size={17} />}
          tone={analysis.conflicts.length ? "red" : "teal"}
        />
        <Metric
          label="Field colleagues"
          value={String(schedule.members.length)}
          detail={`${absentAssignments.length} unavailable-shift flag${absentAssignments.length === 1 ? "" : "s"}`}
          icon={<Users size={17} />}
          tone="default"
        />
      </div>

      {schedule.members.length === 0 ? (
        <EmptyState
          icon={<Users size={26} />}
          title="Build the weekend roster"
          detail="Add the colleagues who will visit sites, then assign each one to a site and time slot."
          action={
            <Button
              variant="primary"
              icon={<UserPlus size={16} />}
              onClick={() => setEditor({ kind: "member" })}
            >
              Add the first colleague
            </Button>
          }
        />
      ) : (
        <div className="schedule-layout">
          <div className="schedule-main">
            <section className="coverage-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">COVERAGE MATRIX</div>
                  <h2>Site × day</h2>
                </div>
                <Badge
                  tone={analysis.uncoveredCells.length ? "danger" : "positive"}
                >
                  {analysis.uncoveredCells.length
                    ? `${analysis.uncoveredCells.length} uncovered`
                    : "Every slot covered"}
                </Badge>
              </div>
              <div
                className="coverage-grid"
                role="table"
                aria-label="Site coverage by day"
                style={
                  { "--schedule-days": analysis.days.length } as CSSProperties
                }
              >
                <div className="coverage-row coverage-head" role="row">
                  <div role="columnheader">Listening site</div>
                  {analysis.days.map((day) => (
                    <div role="columnheader" key={day.date}>
                      <strong>{formatWeekday(day.date)}</strong>
                      <small>{formatDayShort(day.date)}</small>
                      {(day.uncoveredCount > 0 || day.conflictCount > 0) && (
                        <span className="day-flags">
                          {day.uncoveredCount > 0 && (
                            <Badge tone="danger">{day.uncoveredCount} gap{day.uncoveredCount === 1 ? "" : "s"}</Badge>
                          )}
                          {day.conflictCount > 0 && (
                            <Badge tone="warning">{day.conflictCount} clash{day.conflictCount === 1 ? "" : "es"}</Badge>
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {sites.map((site) => (
                  <CoverageRow
                    key={site.id}
                    site={site}
                    analysis={analysis}
                    onAdd={(date) =>
                      setEditor({
                        kind: "assignment",
                        defaultSiteId: site.id,
                        defaultDate: date,
                      })
                    }
                    onEdit={(assignment) =>
                      setEditor({ kind: "assignment", assignment })
                    }
                  />
                ))}
              </div>
            </section>

            <section className="schedule-alerts">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">IMMEDIATE ATTENTION</div>
                  <h2>Where the plan breaks</h2>
                </div>
              </div>
              {analysis.conflicts.length === 0 &&
                absentAssignments.length === 0 &&
                analysis.uncoveredCells.length === 0 && (
                  <div className="clear-message">
                    <CheckCircle2 size={17} /> Every site slot is covered without
                    overlap.
                  </div>
                )}
              {analysis.uncoveredCells.slice(0, 6).map((cell) => (
                <div className="schedule-alert-row danger" key={`gap-${cell.siteId}-${cell.date}`}>
                  <UserX size={16} />
                  <span>
                    <strong>{cell.siteName}</strong> has no available colleague
                    on <strong>{formatDayShort(cell.date)}</strong>.
                  </span>
                </div>
              ))}
              {absentAssignments.map((assignment) => (
                <div
                  className="schedule-alert-row warning"
                  key={`absent-${assignment.id}`}
                >
                  <ShieldAlert size={16} />
                  <span>
                    <strong>{assignment.memberName}</strong> is unavailable on{" "}
                    {formatDayShort(assignment.date)}; the{" "}
                    {assignment.siteName} shift at{" "}
                    {formatTimeRange(assignment.startsAt, assignment.endsAt)}{" "}
                    leaves the site uncovered.
                  </span>
                </div>
              ))}
              {analysis.conflicts.map((conflict) => (
                <div
                  className="schedule-alert-row danger"
                  key={conflict.id}
                >
                  <Clock3 size={16} />
                  <span>{conflict.detail}</span>
                  <small>
                    {formatDayShort(conflict.date)} ·{" "}
                    {formatTimeRange(conflict.startsAt, conflict.endsAt)}
                  </small>
                </div>
              ))}
            </section>
          </div>

          <aside className="schedule-sidebar">
            <section className="roster-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">ROSTER</div>
                  <h3>Weekend team</h3>
                </div>
                <Button
                  variant="ghost"
                  icon={<UserPlus size={15} />}
                  aria-label="Add colleague"
                  onClick={() => setEditor({ kind: "member" })}
                />
              </div>
              <div className="roster-list">
                {schedule.members.map((member) => {
                  const load = analysis.memberLoad.find(
                    (entry) => entry.memberId === member.id,
                  );
                  return (
                    <article className="roster-item" key={member.id}>
                      <div className="roster-item-head">
                        <div>
                          <strong>{member.name}</strong>
                          <small>{member.role}</small>
                        </div>
                        <div className="roster-item-actions">
                          <button
                            aria-label={`Edit ${member.name}`}
                            onClick={() =>
                              setEditor({ kind: "member", member })
                            }
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            aria-label={`Remove ${member.name}`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove ${member.name} and their shifts?`,
                                )
                              ) {
                                const result = removeMember(member.id);
                                if (!result.ok)
                                  notify(
                                    result.message ??
                                      "Colleague could not be removed.",
                                  );
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="roster-availability">
                        {dates.map((date) => {
                          const available = member.availableDates.some(
                            (candidate) => candidate === date,
                          );
                          return (
                            <span
                              key={date}
                              className={`availability-dot ${available ? "available" : "unavailable"}`}
                              title={`${formatWeekday(date)}: ${available ? "available" : "unavailable"}`}
                            >
                              {formatWeekday(date).slice(0, 3)}
                            </span>
                          );
                        })}
                      </div>
                      <div className="roster-load">
                        <span>{load?.activeCount ?? 0} shifts</span>
                        {(load?.absentCount ?? 0) > 0 && (
                          <Badge tone="warning">
                            {load?.absentCount} on unavailable day
                          </Badge>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="shifts-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">WEEKEND TIMELINE</div>
                  <h3>All shifts</h3>
                </div>
                <Badge tone="neutral">{sortedAssignments.length}</Badge>
              </div>
              {sortedAssignments.length === 0 ? (
                <EmptyState
                  icon={<CalendarPlus size={22} />}
                  title="No shifts yet"
                  detail="Assign colleagues to sites to start seeing coverage."
                />
              ) : (
                <div className="shift-list">
                  {sortedAssignments.map((assignment) => (
                    <div
                      className={`shift-row ${assignment.status}`}
                      key={assignment.id}
                    >
                      <span
                        className="site-color"
                        style={{ backgroundColor: assignment.siteColor }}
                      />
                      <div className="shift-main">
                        <strong>{assignment.memberName}</strong>
                        <small>
                          {assignment.siteShortLabel} ·{" "}
                          {formatDayShort(assignment.date)} ·{" "}
                          {formatTimeRange(
                            assignment.startsAt,
                            assignment.endsAt,
                          )}
                        </small>
                        {assignment.note && (
                          <em className="shift-note">{assignment.note}</em>
                        )}
                      </div>
                      <div className="shift-tags">
                        {assignment.status === "absent" && (
                          <Badge tone="danger">Unavailable</Badge>
                        )}
                        {assignment.conflictIds.length > 0 && (
                          <Badge tone="warning">Overlap</Badge>
                        )}
                        {assignment.status === "ok" &&
                          assignment.conflictIds.length === 0 && (
                            <CheckCircle2
                              size={15}
                              className="shift-ok-icon"
                            />
                          )}
                      </div>
                      <div className="shift-actions">
                        <button
                          aria-label={`Edit shift at ${assignment.siteShortLabel}`}
                          onClick={() =>
                            setEditor({
                              kind: "assignment",
                              assignment,
                            })
                          }
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          aria-label={`Remove shift at ${assignment.siteShortLabel}`}
                          onClick={() => {
                            const result = removeAssignment(assignment.id);
                            if (!result.ok)
                              notify(result.message ?? "Shift could not be removed.");
                          }}
                        >
                          <XCircle size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      )}

      {editor.kind === "member" && (
        <MemberEditor
          plan={schedule}
          existing={editor.member}
          onClose={() => setEditor({ kind: "none" })}
          onSave={saveMember}
        />
      )}
      {editor.kind === "assignment" && (
        <AssignmentEditor
          plan={schedule}
          sites={sites}
          existing={editor.assignment}
          defaultSiteId={editor.defaultSiteId}
          defaultDate={editor.defaultDate}
          onClose={() => setEditor({ kind: "none" })}
          onSave={saveAssignment}
        />
      )}
      {toast && (
        <div className="toast toast-positive">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function CoverageRow({
  site,
  analysis,
  onAdd,
  onEdit,
}: {
  site: Site;
  analysis: ReturnType<typeof analyzeSchedule>;
  onAdd: (date: string) => void;
  onEdit: (assignment: ScheduleAssignment) => void;
}) {
  return (
    <div className="coverage-row" role="row">
      <div className="coverage-site" role="rowheader">
        <span className="site-color" style={{ backgroundColor: site.color }} />
        <div>
          <strong>{site.shortLabel}</strong>
          <small>{site.name}</small>
        </div>
      </div>
      {analysis.days.map((day) => {
        const cell = day.cells.find((entry) => entry.siteId === site.id);
        const dayAssignments = analysis.assignments.filter(
          (assignment) =>
            assignment.siteId === site.id && assignment.date === day.date,
        );
        const covered = cell?.covered ?? false;
        return (
          <div
            className={`coverage-cell ${covered ? "covered" : "uncovered"}`}
            role="cell"
            key={day.date}
          >
            {dayAssignments.length === 0 ? (
              <button
                className="coverage-add"
                onClick={() => onAdd(day.date)}
                aria-label={`Add a shift at ${site.name} on ${formatDayShort(day.date)}`}
              >
                <Plus size={14} /> Assign
              </button>
            ) : (
              <div className="coverage-shifts">
                {dayAssignments.map((assignment) => (
                  <button
                    key={assignment.id}
                    className={`coverage-shift ${assignment.status} ${assignment.conflictIds.length ? "conflict" : ""}`}
                    onClick={() => onEdit(assignment)}
                    title={
                      assignment.status === "absent"
                        ? `${assignment.memberName} is unavailable this day`
                        : `Edit ${assignment.memberName}'s shift`
                    }
                  >
                    <span className="coverage-shift-name">
                      {assignment.memberName}
                    </span>
                    <small>
                      {formatTimeRange(assignment.startsAt, assignment.endsAt)}
                    </small>
                    {assignment.status === "absent" && (
                      <span className="coverage-shift-flag">
                        <UserX size={11} /> unavailable
                      </span>
                    )}
                    {assignment.status !== "absent" &&
                      assignment.conflictIds.length > 0 && (
                        <span className="coverage-shift-flag">
                          <AlertTriangle size={11} /> overlap
                        </span>
                      )}
                  </button>
                ))}
                <button
                  className="coverage-add-mini"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAdd(day.date);
                  }}
                  aria-label={`Add another shift at ${site.name} on ${formatDayShort(day.date)}`}
                >
                  <Plus size={12} />
                </button>
              </div>
            )}
            {!covered && (
              <span className="coverage-gap-label">
                <XCircle size={11} /> No cover
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
