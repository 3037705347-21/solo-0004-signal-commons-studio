import { describe, expect, it } from "vitest";
import { addDays } from "./dateMath";

describe("calendar date math", () => {
  it("keeps date-only arithmetic stable across month and year boundaries", () => {
    expect(addDays("2026-09-19", 1)).toBe("2026-09-20");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
