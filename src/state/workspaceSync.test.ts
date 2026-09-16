import { describe, expect, it } from "vitest";
import { createSeedStudy } from "./seed";
import { shouldAcceptIncomingWorkspace } from "./workspaceSync";

describe("shouldAcceptIncomingWorkspace", () => {
  it("ignores records committed against an older revision", () => {
    const current = { ...createSeedStudy(), revision: 5 };
    const incoming = { ...createSeedStudy(), revision: 4 };
    expect(shouldAcceptIncomingWorkspace(incoming, current)).toBe(false);
  });

  it("ignores the record this tab already holds", () => {
    const current = createSeedStudy();
    const incoming = { ...createSeedStudy() };
    expect(shouldAcceptIncomingWorkspace(incoming, current)).toBe(false);
  });

  it("accepts a newer revision", () => {
    const current = createSeedStudy();
    const incoming = {
      ...createSeedStudy(),
      revision: 1,
      updatedAt: "2026-09-16T10:00:00.000Z",
    };
    expect(shouldAcceptIncomingWorkspace(incoming, current)).toBe(true);
  });

  it("accepts the same revision when the update timestamp differs", () => {
    const current = createSeedStudy();
    const incoming = {
      ...createSeedStudy(),
      updatedAt: "2026-09-16T10:00:00.000Z",
    };
    expect(shouldAcceptIncomingWorkspace(incoming, current)).toBe(true);
  });
});
