import { CalendarCheck2, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import { formatWeekday, formatDayShort } from "../../domain/formatters";
import {
  isMemberAvailable,
  planDates,
} from "../../domain/schedule";
import { assignmentOverlapDraft } from "../../domain/scheduleValidation";
import type {
  AssignmentDraft,
  ScheduleAssignment,
  SchedulePlan,
  Site,
  TeamMember,
} from "../../domain/models";

function emptyDraft(plan: SchedulePlan): AssignmentDraft {
  return {
    memberId: plan.members[0]?.id ?? "",
    siteId: "",
    date: planDates(plan)[0] ?? plan.weekendStart,
    startsAt: "09:00",
    endsAt: "10:00",
    note: "",
  };
}

export function AssignmentEditor({
  plan,
  sites,
  existing,
  defaultSiteId,
  defaultDate,
  onClose,
  onSave,
}: {
  plan: SchedulePlan;
  sites: Site[];
  existing?: ScheduleAssignment;
  defaultSiteId?: string;
  defaultDate?: string;
  onClose: () => void;
  onSave: (draft: AssignmentDraft, existing?: ScheduleAssignment) => {
    ok: boolean;
    errors?: Record<string, string>;
    message?: string;
  };
}) {
  const [draft, setDraft] = useState<AssignmentDraft>(
    existing
      ? {
          memberId: existing.memberId,
          siteId: existing.siteId,
          date: existing.date,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          note: existing.note ?? "",
        }
      : { ...emptyDraft(plan), siteId: defaultSiteId ?? "", date: defaultDate ?? planDates(plan)[0] ?? plan.weekendStart },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof AssignmentDraft>(
    key: K,
    value: AssignmentDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const dates = planDates(plan);
  const overlap = assignmentOverlapDraft(draft, plan, existing?.id);
  const member = plan.members.find((candidate) => candidate.id === draft.memberId);
  const memberUnavailable =
    member && !isMemberAvailable(member, draft.date);
  const overlapSite = sites.find((site) => site?.id === overlap?.siteId);

  return (
    <Modal
      eyebrow={existing ? "EDIT SHIFT" : "NEW SHIFT"}
      title={existing ? "Change this site visit" : "Assign a site visit"}
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
              const result = onSave(draft, existing);
              if (!result.ok) setErrors(result.errors ?? {});
            }}
          >
            {existing ? "Save changes" : "Add to plan"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <SelectField
          label="Colleague"
          value={draft.memberId}
          error={errors.memberId}
          onChange={(event) => update("memberId", event.target.value)}
        >
          <option value="">Choose a colleague</option>
          {plan.members.map((candidate: TeamMember) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} · {candidate.role}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Listening site"
          value={draft.siteId}
          error={errors.siteId}
          onChange={(event) => update("siteId", event.target.value)}
        >
          <option value="">Choose a site</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Visit day"
          value={draft.date}
          error={errors.date}
          onChange={(event) => update("date", event.target.value)}
        >
          {dates.map((date) => (
            <option key={date} value={date}>
              {formatWeekday(date)} · {formatDayShort(date)}
            </option>
          ))}
        </SelectField>
        <div className="form-row">
          <TextField
            label="Start"
            type="time"
            aria-label="Start time"
            value={draft.startsAt}
            error={errors.startsAt}
            onChange={(event) => update("startsAt", event.target.value)}
          />
          <TextField
            label="End"
            type="time"
            aria-label="End time"
            value={draft.endsAt}
            error={errors.endsAt}
            onChange={(event) => update("endsAt", event.target.value)}
          />
        </div>
        <TextField
          label="Visit note (optional)"
          value={draft.note}
          onChange={(event) => update("note", event.target.value)}
          placeholder="Equipment, consent window, or handoff note."
        />
      </div>
      {(memberUnavailable || overlap) && (
        <div className="schedule-editor-warnings">
          {memberUnavailable && (
            <div className="schedule-warning-row danger">
              <CalendarCheck2 size={15} />
              <span>
                {member?.name} is not available on {formatDayShort(draft.date)}.
                Saving marks this site uncovered for that day.
              </span>
            </div>
          )}
          {overlap && (
            <div className="schedule-warning-row warning">
              <CalendarCheck2 size={15} />
              <span>
                Overlaps {member?.name ?? "the colleague"}'s{" "}
                {overlap.startsAt}–{overlap.endsAt} shift
                {overlapSite ? ` at ${overlapSite.name}` : ""}.
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
