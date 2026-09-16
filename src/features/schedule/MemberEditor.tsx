import { Send, UserX } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { TextField } from "../../components/TextField";
import { formatWeekday, formatDayShort } from "../../domain/formatters";
import { planDates } from "../../domain/schedule";
import type {
  MemberDraft,
  SchedulePlan,
  TeamMember,
} from "../../domain/models";

export function MemberEditor({
  plan,
  existing,
  onClose,
  onSave,
}: {
  plan: SchedulePlan;
  existing?: TeamMember;
  onClose: () => void;
  onSave: (draft: MemberDraft, existing?: TeamMember) => {
    ok: boolean;
    errors?: Record<string, string>;
  };
}) {
  const dates = planDates(plan);
  const [draft, setDraft] = useState<MemberDraft>(
    existing
      ? {
          name: existing.name,
          role: existing.role,
          availableDates: [...existing.availableDates],
        }
      : { name: "", role: "", availableDates: [...dates] },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof MemberDraft>(key: K, value: MemberDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleDate = (date: string) =>
    setDraft((current) => ({
      ...current,
      availableDates: current.availableDates.includes(date)
        ? current.availableDates.filter((candidate) => candidate !== date)
        : [...current.availableDates, date],
    }));

  return (
    <Modal
      eyebrow={existing ? "EDIT COLLEAGUE" : "NEW COLLEAGUE"}
      title={existing ? existing.name : "Add a colleague to the roster"}
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
            {existing ? "Save changes" : "Add colleague"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Name"
          value={draft.name}
          error={errors.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="Colleague's name"
        />
        <TextField
          label="Role"
          value={draft.role}
          error={errors.role}
          onChange={(event) => update("role", event.target.value)}
          placeholder="Field recordist, consent lead…"
        />
      </div>
      <fieldset className="availability-field">
        <legend className="field-label">
          Available visit days
        </legend>
        <div className="availability-options">
          {dates.map((date) => {
            const selected = draft.availableDates.includes(date);
            return (
              <button
                type="button"
                key={date}
                className={`availability-chip ${selected ? "selected" : ""}`}
                aria-pressed={selected}
                onClick={() => toggleDate(date)}
              >
                <strong>{formatWeekday(date)}</strong>
                <small>{formatDayShort(date)}</small>
              </button>
            );
          })}
        </div>
        <span className="field-hint">
          Deselect a day to flag the colleague as unavailable; their existing
          shifts that day become uncovered.
        </span>
        {draft.availableDates.length === 0 && (
          <div className="schedule-warning-row danger member-unavailable">
            <UserX size={15} />
            <span>
              No visit days selected — {existing ? existing.name : "this colleague"}{" "}
              is unavailable all weekend. Every existing shift assigned to them
              will immediately count as an uncovered site.
            </span>
          </div>
        )}
      </fieldset>
    </Modal>
  );
}
