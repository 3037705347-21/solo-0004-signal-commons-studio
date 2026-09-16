import { addDays, isValidDate, sameDay } from "./dateMath";
import type {
  ScheduleAssignment,
  SchedulePlan,
  Site,
  TeamMember,
} from "./models";

export type AssignmentStatus = "ok" | "absent" | "unlinked";

export interface AnalyzedAssignment extends ScheduleAssignment {
  status: AssignmentStatus;
  memberName: string;
  siteName: string;
  siteShortLabel: string;
  siteColor: string;
  conflictIds: string[];
}

export interface ScheduleConflict {
  id: string;
  date: string;
  memberId: string;
  memberName: string;
  assignmentIds: string[];
  sites: string[];
  startsAt: string;
  endsAt: string;
  detail: string;
}

export interface CoverageCell {
  siteId: string;
  siteName: string;
  siteShortLabel: string;
  siteColor: string;
  date: string;
  assignmentIds: string[];
  covered: boolean;
}

export interface CoverageDay {
  date: string;
  cells: CoverageCell[];
  uncoveredCount: number;
  conflictCount: number;
}

export interface ScheduleAnalysis {
  dates: string[];
  assignments: AnalyzedAssignment[];
  conflicts: ScheduleConflict[];
  days: CoverageDay[];
  uncoveredCells: CoverageCell[];
  coveredCells: number;
  totalCells: number;
  coverageRatio: number;
  memberLoad: Array<{
    memberId: string;
    memberName: string;
    role: string;
    activeCount: number;
    absentCount: number;
  }>;
}

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function isValidTime(value: string): boolean {
  const match = TIME_PATTERN.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function timeMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Half-open interval overlap: adjacent slots (10:00–11:00, 11:00–12:00) do not clash. */
export function rangesOverlap(
  startsAt: string,
  endsAt: string,
  otherStartsAt: string,
  otherEndsAt: string,
): boolean {
  return timeMinutes(startsAt) < timeMinutes(otherEndsAt) &&
    timeMinutes(otherStartsAt) < timeMinutes(endsAt);
}

export function isMemberAvailable(
  member: TeamMember,
  date: string,
): boolean {
  return (
    member.availableDates.length === 0 ||
    member.availableDates.some((candidate) => sameDay(candidate, date))
  );
}

export function planDates(plan: SchedulePlan): string[] {
  if (
    isValidDate(plan.weekendStart) &&
    isValidDate(plan.weekendEnd) &&
    plan.weekendEnd >= plan.weekendStart
  ) {
    const span = Math.round(
      (new Date(`${plan.weekendEnd}T00:00:00`).getTime() -
        new Date(`${plan.weekendStart}T00:00:00`).getTime()) /
        86_400_000,
    );
    if (span <= 6) {
      return Array.from({ length: span + 1 }, (_, offset) =>
        addDays(plan.weekendStart, offset),
      );
    }
  }
  return [plan.weekendStart, plan.weekendEnd].filter(isValidDate);
}

/** Saturday of the week containing the reference date, computed in UTC. */
export function nextWeekendStart(from = new Date()): string {
  const day = from.getUTCDay();
  const delta = (6 - day + 7) % 7;
  const date = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + delta),
  );
  return date.toISOString().slice(0, 10);
}

export function emptySchedulePlan(from = new Date()): SchedulePlan {
  const weekendStart = nextWeekendStart(from);
  return {
    weekendStart,
    weekendEnd: addDays(weekendStart, 1),
    members: [],
    assignments: [],
  };
}

function statusFor(
  assignment: ScheduleAssignment,
  members: Map<string, TeamMember>,
): AssignmentStatus {
  const member = members.get(assignment.memberId);
  if (!member) return "unlinked";
  if (!isMemberAvailable(member, assignment.date)) return "absent";
  return "ok";
}

export function analyzeSchedule(
  plan: SchedulePlan,
  sites: Site[],
): ScheduleAnalysis {
  const orderedSites = sites
    .slice()
    .sort((left, right) =>
      left.sequence === right.sequence
        ? left.id.localeCompare(right.id)
        : left.sequence - right.sequence,
    );
  const members = new Map(plan.members.map((member) => [member.id, member]));
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const dates = planDates(plan);

  const assignments: AnalyzedAssignment[] = plan.assignments
    .filter((assignment) =>
      dates.some((date) => sameDay(date, assignment.date)),
    )
    .map((assignment) => {
      const member = members.get(assignment.memberId);
      const site = siteById.get(assignment.siteId);
      return {
        ...assignment,
        status: statusFor(assignment, members),
        memberName: member?.name ?? "Unassigned colleague",
        siteName: site?.name ?? "Removed site",
        siteShortLabel: site?.shortLabel ?? "—",
        siteColor: site?.color ?? "#9aa09a",
        conflictIds: [],
      };
    });

  const conflicts: ScheduleConflict[] = [];
  const activeByMember = new Map<string, AnalyzedAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.status !== "ok") continue;
    const group = activeByMember.get(assignment.memberId) ?? [];
    group.push(assignment);
    activeByMember.set(assignment.memberId, group);
  }
  let conflictIndex = 0;
  for (const [memberId, group] of activeByMember) {
    const byDate = new Map<string, AnalyzedAssignment[]>();
    for (const assignment of group) {
      const day = byDate.get(assignment.date) ?? [];
      day.push(assignment);
      byDate.set(assignment.date, day);
    }
    for (const [date, dayAssignments] of byDate) {
      for (let index = 0; index < dayAssignments.length; index += 1) {
        for (let other = index + 1; other < dayAssignments.length; other += 1) {
          const first = dayAssignments[index];
          const second = dayAssignments[other];
          if (
            !rangesOverlap(
              first.startsAt,
              first.endsAt,
              second.startsAt,
              second.endsAt,
            )
          )
            continue;
          const startsAt =
            first.startsAt < second.startsAt ? first.startsAt : second.startsAt;
          const endsAt =
            first.endsAt > second.endsAt ? first.endsAt : second.endsAt;
          const conflict: ScheduleConflict = {
            id: `conflict-${conflictIndex++}`,
            date,
            memberId,
            memberName: first.memberName,
            assignmentIds: [first.id, second.id],
            sites: [first.siteShortLabel, second.siteShortLabel],
            startsAt,
            endsAt,
            detail: `${first.memberName} is expected at ${first.siteName} and ${second.siteName} at the same time.`,
          };
          conflicts.push(conflict);
          first.conflictIds.push(conflict.id);
          second.conflictIds.push(conflict.id);
        }
      }
    }
  }

  const conflictCountByDate = new Map<string, number>();
  for (const conflict of conflicts) {
    conflictCountByDate.set(
      conflict.date,
      (conflictCountByDate.get(conflict.date) ?? 0) + 1,
    );
  }

  const days: CoverageDay[] = dates.map((date) => {
    const cells: CoverageCell[] = orderedSites.map((site) => {
      const dayAssignments = assignments.filter(
        (assignment) =>
          sameDay(assignment.date, date) && assignment.siteId === site.id,
      );
      return {
        siteId: site.id,
        siteName: site.name,
        siteShortLabel: site.shortLabel,
        siteColor: site.color,
        date,
        assignmentIds: dayAssignments.map((assignment) => assignment.id),
        covered: dayAssignments.some(
          (assignment) => assignment.status === "ok",
        ),
      };
    });
    return {
      date,
      cells,
      uncoveredCount: cells.filter((cell) => !cell.covered).length,
      conflictCount: conflictCountByDate.get(date) ?? 0,
    };
  });

  const uncoveredCells = days.flatMap((day) =>
    day.cells.filter((cell) => !cell.covered),
  );
  const coveredCells = days.reduce(
    (sum, day) => sum + day.cells.filter((cell) => cell.covered).length,
    0,
  );
  const totalCells = days.reduce((sum, day) => sum + day.cells.length, 0);

  const memberLoad = plan.members.map((member) => {
    const memberAssignments = assignments.filter(
      (assignment) => assignment.memberId === member.id,
    );
    return {
      memberId: member.id,
      memberName: member.name,
      role: member.role,
      activeCount: memberAssignments.filter(
        (assignment) => assignment.status === "ok",
      ).length,
      absentCount: memberAssignments.filter(
        (assignment) => assignment.status === "absent",
      ).length,
    };
  });

  return {
    dates,
    assignments,
    conflicts,
    days,
    uncoveredCells,
    coveredCells,
    totalCells,
    coverageRatio: totalCells ? coveredCells / totalCells : 0,
    memberLoad,
  };
}
