import { describe, expect, it } from "vitest";
import { createSeedStudy } from "../state/seed";
import { analyzeSchedule, nextWeekendStart, planDates } from "./schedule";

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
