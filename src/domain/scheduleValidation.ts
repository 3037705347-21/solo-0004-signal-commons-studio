import { isValidDate, sameDay } from "./dateMath";
import { isValidTime, planDates, rangesOverlap } from "./schedule";
import type {
  AssignmentDraft,
  MemberDraft,
  SchedulePlan,
  TeamMember,
  ValidationError,
} from "./models";
import { timeMinutes } from "./schedule";

export function validateMemberDraft(
  draft: MemberDraft,
  members: TeamMember[],
  existingId?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = draft.name.trim();
  if (!name) {
    errors.push({ field: "name", message: "Give the colleague a name." });
  } else if (
    members.some(
      (member) =>
        member.id !== existingId &&
        member.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.push({
      field: "name",
      message: "A colleague with this name is already on the roster.",
    });
  }
  if (!draft.role.trim()) {
    errors.push({ field: "role", message: "Add a role or team function." });
  }
  return errors;
}

export function validateAssignmentDraft(
  draft: AssignmentDraft,
  plan: SchedulePlan,
  existingId?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!draft.memberId)
    errors.push({ field: "memberId", message: "Choose a colleague." });
  if (!draft.siteId)
    errors.push({ field: "siteId", message: "Choose a site." });
  const plannedDates = planDates(plan);
  if (!draft.date || !isValidDate(draft.date)) {
    errors.push({ field: "date", message: "Choose a visit day." });
  } else if (!plannedDates.some((date) => sameDay(date, draft.date))) {
    errors.push({
      field: "date",
      message: "Pick a day inside the planned weekend.",
    });
  }
  if (!isValidTime(draft.startsAt))
    errors.push({ field: "startsAt", message: "Use a valid start time." });
  if (!isValidTime(draft.endsAt))
    errors.push({ field: "endsAt", message: "Use a valid end time." });
  if (
    isValidTime(draft.startsAt) &&
    isValidTime(draft.endsAt) &&
    timeMinutes(draft.endsAt) <= timeMinutes(draft.startsAt)
  ) {
    errors.push({
      field: "endsAt",
      message: "The end must be after the start.",
    });
  }

  const duplicate = plan.assignments.find((assignment) => {
    if (assignment.id === existingId) return false;
    return (
      assignment.memberId === draft.memberId &&
      assignment.siteId === draft.siteId &&
      sameDay(assignment.date, draft.date) &&
      assignment.startsAt === draft.startsAt &&
      assignment.endsAt === draft.endsAt
    );
  });
  if (duplicate) {
    errors.push({
      field: "siteId",
      message: "This exact shift is already on the plan.",
    });
  }
  return errors;
}

/** Soft, non-blocking overlap warning used while editing and in the live plan. */
export function assignmentOverlapDraft(
  draft: AssignmentDraft,
  plan: SchedulePlan,
  existingId?: string,
): SchedulePlan["assignments"][number] | undefined {
  if (
    !draft.memberId ||
    !draft.date ||
    !isValidTime(draft.startsAt) ||
    !isValidTime(draft.endsAt) ||
    timeMinutes(draft.endsAt) <= timeMinutes(draft.startsAt)
  )
    return undefined;
  return plan.assignments.find((assignment) => {
    if (assignment.id === existingId) return false;
    return (
      assignment.memberId === draft.memberId &&
      sameDay(assignment.date, draft.date) &&
      rangesOverlap(
        draft.startsAt,
        draft.endsAt,
        assignment.startsAt,
        assignment.endsAt,
      )
    );
  });
}
