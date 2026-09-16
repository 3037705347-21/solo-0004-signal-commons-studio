import { describe, expect, it } from "vitest";
import { createSeedStudy } from "../state/seed";
import type { SchedulePlan, Site, TeamMember } from "./models";
import {
  analyzeSchedule,
  isMemberAvailable,
  nextWeekendStart,
  planDates,
} from "./schedule";

const SATURDAY = "2026-09-19";
const SUNDAY = "2026-09-20";

function buildPlan(member: TeamMember): { plan: SchedulePlan; sites: Site[] } {
  const seed = createSeedStudy();
  const sites = seed.sites.filter((site) => site.id === "site-voices");
  const plan: SchedulePlan = {
    weekendStart: SATURDAY,
    weekendEnd: SUNDAY,
    members: [member],
    assignments: [SATURDAY, SUNDAY].map((date, index) => ({
      id: `assign-${index}`,
      memberId: member.id,
      siteId: "site-voices",
      date,
      startsAt: "09:00",
      endsAt: "10:00",
      createdAt: "2026-09-08T09:00:00.000Z",
      updatedAt: "2026-09-08T09:00:00.000Z",
    })),
  };
  return { plan, sites };
}

describe("team availability", () => {
  const base: TeamMember = {
    id: "member-a",
    name: "Avery",
    role: "Recordist",
    availableDates: [SATURDAY, SUNDAY],
    createdAt: "2026-09-08T09:00:00.000Z",
    updatedAt: "2026-09-08T09:00:00.000Z",
  };

  it("treats an empty availability list as unavailable on every day", () => {
    const away = { ...base, availableDates: [] };
    expect(isMemberAvailable(away, SATURDAY)).toBe(false);
    expect(isMemberAvailable(away, SUNDAY)).toBe(false);
  });

  it("keeps a member available only on selected days", () => {
    const saturdayOnly = { ...base, availableDates: [SATURDAY] };
    expect(isMemberAvailable(saturdayOnly, SATURDAY)).toBe(true);
    expect(isMemberAvailable(saturdayOnly, SUNDAY)).toBe(false);
  });

  it("marks every existing shift uncovered when all weekend days are deselected", () => {
    const { plan, sites } = buildPlan({ ...base, availableDates: [] });
    const analysis = analyzeSchedule(plan, sites);
    expect(analysis.assignments.every((a) => a.status === "absent")).toBe(true);
    expect(analysis.coveredCells).toBe(0);
    expect(analysis.totalCells).toBe(2);
    expect(analysis.uncoveredCells).toHaveLength(2);
    const voices = analysis.days.flatMap((day) =>
      day.cells.filter((cell) => cell.siteId === "site-voices"),
    );
    expect(voices.map((cell) => cell.covered)).toEqual([false, false]);
  });

  it("marks only the deselected day uncovered and covers the selected day", () => {
    const { plan, sites } = buildPlan({
      ...base,
      availableDates: [SUNDAY],
    });
    const analysis = analyzeSchedule(plan, sites);
    const byDate = new Map(
      analysis.days.map((day) => [
        day.date,
        day.cells.find((cell) => cell.siteId === "site-voices")?.covered,
      ]),
    );
    expect(byDate.get(SATURDAY)).toBe(false);
    expect(byDate.get(SUNDAY)).toBe(true);
  });

  it("restores coverage when a day is reselected", () => {
    const away = { ...base, availableDates: [] };
    const { plan, sites } = buildPlan(away);
    expect(analyzeSchedule(plan, sites).coveredCells).toBe(0);
    const restored: SchedulePlan = {
      ...plan,
      members: [{ ...away, availableDates: [SATURDAY, SUNDAY] }],
    };
    const analysis = analyzeSchedule(restored, sites);
    expect(analysis.coveredCells).toBe(2);
    expect(
      analysis.assignments.every((assignment) => assignment.status === "ok"),
    ).toBe(true);
  });
});

describe("field schedule coverage", () => {
  it("keeps every user-selected weekend day, even in UTC+ timezones", () => {
    const plan = createSeedStudy().schedule;
    expect(planDates(plan)).toEqual(["2026-09-19", "2026-09-20"]);
  });

  it("marks a site with only an unavailable colleague as uncovered", () => {
    const { schedule, sites } = createSeedStudy();
    const analysis = analyzeSchedule(schedule, sites);
    const sunday = analysis.days.find((day) => day.date === "2026-09-20");
    expect(sunday).toBeDefined();
    const voices = sunday!.cells.find((cell) => cell.siteId === "site-voices");
    expect(voices?.covered).toBe(false);

    const rosaSunday = analysis.assignments.find(
      (assignment) =>
        assignment.id === "assign-sun-voices-rosa-absent",
    );
    expect(rosaSunday?.status).toBe("absent");
  });

  it("does not move or drop Saturday assignments", () => {
    const { schedule, sites } = createSeedStudy();
    const analysis = analyzeSchedule(schedule, sites);
    const saturday = analysis.days.find((day) => day.date === "2026-09-19");
    const rhythm = saturday!.cells.find((cell) => cell.siteId === "site-rhythm");
    expect(rhythm?.covered).toBe(false);
    const threshold = saturday!.cells.find(
      (cell) => cell.siteId === "site-threshold",
    );
    expect(threshold?.covered).toBe(true);
    // Milo's double booking stays visible for Saturday.
    expect(
      analysis.conflicts.some(
        (conflict) =>
          conflict.date === "2026-09-19" && conflict.memberId === "member-milo",
      ),
    ).toBe(true);
  });

  it("computes the coming Saturday regardless of reference weekday", () => {
    // 2026-09-16 is a Wednesday; Saturday is 2026-09-19.
    expect(nextWeekendStart(new Date("2026-09-16T12:00:00Z"))).toBe(
      "2026-09-19",
    );
    expect(nextWeekendStart(new Date("2026-09-19T23:30:00Z"))).toBe(
      "2026-09-19",
    );
  });
});
