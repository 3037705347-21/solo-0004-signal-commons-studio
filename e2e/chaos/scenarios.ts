/**
 * Chaos drill scenario catalog.
 *
 * Single source of truth shared by the spec files (annotations), the custom
 * reporter (report sections), and the npm/CI gate (grep ids). Every scenario
 * can run alone via `npm run drill:one -- <id>` or as part of the full gate.
 */

export type DrillSuite = "concurrency" | "recovery" | "scale";

export type DrillSeverity = "critical" | "high" | "medium";

export interface DrillScenario {
  id: string;
  suite: DrillSuite;
  title: string;
  /** What the drill deliberately breaks. */
  injectedFault: string;
  /** Invariant the product must hold while the fault is present. */
  guarantee: string;
  /** What a user or published study loses if this invariant breaks. */
  businessImpact: string;
  /** How failure of the drill maps to the release gate. */
  severity: DrillSeverity;
}

export const DRILL_SUITE_TITLES: Record<DrillSuite, string> = {
  concurrency: "Concurrent multi-tab operations",
  recovery: "Abrupt failure and recovery",
  scale: "Large data volume",
};

export const DRILL_SCENARIOS: DrillScenario[] = [
  {
    id: "CC-01",
    suite: "concurrency",
    title: "Commits from several tabs converge in revision order",
    injectedFault:
      "Four tabs commit one new recording each in an interleaved barrier sequence.",
    guarantee:
      "Every commit lands exactly once; disk revision advances by exactly the number of commits; all tabs converge on the same library.",
    businessImpact:
      "Catalogue clips entered by simultaneous field researchers would silently disappear or duplicate.",
    severity: "critical",
  },
  {
    id: "CC-02",
    suite: "concurrency",
    title: "A stale tab cannot overwrite a newer committed revision",
    injectedFault:
      "A tab is frozen before it processes another tab's storage event, then commits on the stale revision.",
    guarantee:
      "The compare-before-commit guard refuses the stale write and the tab heals to the winning revision; committed work survives.",
    businessImpact:
      "An editor working from an old tab could roll back a teammate's resolved consent finding or route change.",
    severity: "critical",
  },
  {
    id: "CC-03",
    suite: "concurrency",
    title: "Duplicate and stale storage events are idempotent",
    injectedFault:
      "The live page is flooded with twenty identical storage events for the same committed record.",
    guarantee:
      "Revision, library content, and release state stay constant; no event throws or triggers a regression.",
    businessImpact:
      "Event duplication during browser wake-up could revert the quality desk or corrupt the audit trail.",
    severity: "medium",
  },
  {
    id: "FR-01",
    suite: "recovery",
    title: "Abrupt tab kill keeps the last committed state",
    injectedFault:
      "The renderer process is killed immediately after a commit, without beforeunload.",
    guarantee:
      "The checksummed primary record is complete; reopening shows the committed clip and revision.",
    businessImpact:
      "A browser crash during fieldwork would lose the recording metadata just entered.",
    severity: "critical",
  },
  {
    id: "FR-02",
    suite: "recovery",
    title: "Corrupt primary record falls back to the last backup",
    injectedFault:
      "The primary record is overwritten with checksum-invalid bytes while a valid backup exists.",
    guarantee:
      "Startup loads and validates the backup; no seed reset and no partial record reaches the UI.",
    businessImpact:
      "A single bad write would wipe the whole study instead of costing at most one command.",
    severity: "critical",
  },
  {
    id: "FR-03",
    suite: "recovery",
    title: "A truncated primary record is rejected, not half-loaded",
    injectedFault: "Primary JSON is cut in half to simulate a torn write.",
    guarantee:
      "Parse failure routes to the intact backup; record counts match the backup exactly.",
    businessImpact:
      "A power loss mid-write could expose a half-populated route with dangling clip references.",
    severity: "high",
  },
  {
    id: "FR-04",
    suite: "recovery",
    title: "Both records damaged degrades safely to the seed study",
    injectedFault: "Primary and backup are replaced with unparseable bytes.",
    guarantee:
      "The workspace boots to the sample study instead of an error screen, and accepts new commits.",
    businessImpact:
      "Total local corruption should strand the team in a broken tab rather than a usable reset.",
    severity: "high",
  },
  {
    id: "FR-05",
    suite: "recovery",
    title: "Dangling and duplicate route references are repaired on load",
    injectedFault:
      "A hand-edited record points a site at a missing clip and lists one clip twice.",
    guarantee:
      "Startup validation removes the dangling id and the duplicate placement, leaving each clip placed at most once.",
    businessImpact:
      "Damaged route references could duplicate consent-bearing clips in the exported checklist.",
    severity: "high",
  },
  {
    id: "FR-06",
    suite: "recovery",
    title: "A frozen ready release survives a crash-and-reopen cycle",
    injectedFault:
      "A passing release is frozen, the tab is killed, and the workspace reopened.",
    guarantee:
      "The release stays ready with the same fingerprint and sequence, and the snapshot remains exportable.",
    businessImpact:
      "A publication cleared for release could demand a full re-review after every browser hiccup.",
    severity: "high",
  },
  {
    id: "FR-07",
    suite: "recovery",
    title: "A storage outage degrades visibly and then heals without data loss",
    injectedFault:
      "All persistence writes start throwing quota errors mid-session, then the quota is restored.",
    guarantee:
      "The workspace shows an explicit save-unavailable state, the last committed record is never damaged, and writes resume after recovery.",
    businessImpact:
      "A full-disk or private-mode write failure could silently drop edits while showing the user a healthy workspace.",
    severity: "high",
  },
  {
    id: "LD-01",
    suite: "scale",
    title: "A 1,200-clip library renders and stays interactive",
    injectedFault:
      "Storage is seeded with 1,200 recordings, 32 placed clips, and 150 findings.",
    guarantee:
      "Library statistics are exact, search filters correctly, and the page reaches a stable, error-free state.",
    businessImpact:
      "Large multi-neighborhood studies would become unusable as the catalogue grows past a few hundred clips.",
    severity: "high",
  },
  {
    id: "LD-02",
    suite: "scale",
    title: "Bulk placement recalculates route constraints at scale",
    injectedFault:
      "Twenty unplaced clips are assigned into high-capacity sites in one session.",
    guarantee:
      "Every placement persists once, placed counts are exact, and no capacity error is raised within configured limits.",
    businessImpact:
      "Planning a site with many clips could lose assignments or report false capacity blocks.",
    severity: "medium",
  },
  {
    id: "LD-03",
    suite: "scale",
    title: "Readiness evaluation stays correct on a large workspace",
    injectedFault:
      "The release engine evaluates 1,200 clips with open non-blocking findings.",
    guarantee:
      "Blockers and cautions reflect the large dataset exactly; the gate result is deterministic across reruns.",
    businessImpact:
      "A wrong large-scale readiness verdict could publish a route missing featured clips.",
    severity: "high",
  },
];

export const DRILL_SCENARIO_BY_ID = new Map(
  DRILL_SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

export function getScenario(id: string): DrillScenario {
  const scenario = DRILL_SCENARIO_BY_ID.get(id);
  if (!scenario) throw new Error(`Unknown chaos drill scenario: ${id}`);
  return scenario;
}
