import { describe, expect, it } from "vitest";
import { buildSiteChecklist, serializeSiteChecklistCsv } from "./siteChecklist";
import { createSeedStudy } from "../state/seed";

describe("site checklist", () => {
  it("lists placed clips with recording-scoped findings", () => {
    const state = createSeedStudy();
    const checklist = buildSiteChecklist(state, "site-voices");
    expect(checklist?.entries[0].title).toBe("Courtyard conversation");
    expect(checklist?.entries[0].durationSeconds).toBe(241);
    expect(
      checklist?.entries[0].unresolvedFindings.every(
        (finding) => finding.scope === "recording" || finding.scope === "site",
      ),
    ).toBe(true);
  });

  it("serializes audio durations and clip rows to CSV", () => {
    const checklist = buildSiteChecklist(createSeedStudy(), "site-rhythm");
    const csv = checklist ? serializeSiteChecklistCsv(checklist) : "";
    expect(csv).toContain("Clip");
    expect(csv).toContain("Tram brake chorus");
    expect(csv).toContain("duration (sec)");
  });
});
