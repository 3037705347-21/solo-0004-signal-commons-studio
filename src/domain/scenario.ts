import { isConsentUsable } from "./consent";
import type {
  ListenerProjection,
  ListenerScenarioInput,
  RouteAnalysis,
  StudyState,
} from "./models";
const PACE: Record<ListenerScenarioInput["pace"], number> = {
  brief: 0.82,
  steady: 1,
  deep: 1.28,
};
export function clampScenario(
  input: ListenerScenarioInput,
): ListenerScenarioInput {
  return {
    pace: input.pace,
    accessPriority: Math.max(
      0,
      Math.min(100, Math.round(input.accessPriority)),
    ),
    listenerCount: Math.max(1, Math.min(24, Math.round(input.listenerCount))),
  };
}
export function projectScenario(
  state: StudyState,
  analysis: RouteAnalysis,
  raw: ListenerScenarioInput,
): ListenerProjection {
  const input = clampScenario(raw);
  const groupDrag = 1 + Math.max(0, input.listenerCount - 4) * 0.025;
  const accessDrag = 1 + input.accessPriority / 1000;
  const durationSeconds = Math.round(
    analysis.totalDurationSeconds * PACE[input.pace] * groupDrag * accessDrag,
  );
  const pressureSiteIds = analysis.sites
    .filter(
      (site) =>
        site.utilization >= (input.pace === "deep" ? 0.7 : 0.85) ||
        site.clipUtilization >= 0.9,
    )
    .map((site) => site.siteId);
  const accessScore = Math.max(
    0,
    Math.round(
      (state.recordings.filter(
        (recording) =>
          recording.transcriptStatus === "verified" &&
          isConsentUsable(recording.id, state.consents, "route"),
      ).length /
        Math.max(1, state.recordings.length)) *
        100,
    ),
  );
  const continuityScore = Math.round(
    analysis.roleCoverage * 70 + analysis.featuredCoverage * 30,
  );
  const comfortScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          pressureSiteIds.length * 12 -
          Math.max(0, input.listenerCount - 10) * 2,
      ),
    ),
  );
  const recommendations: string[] = [];
  if (pressureSiteIds.length)
    recommendations.push("Add a pause or split the busiest listening site.");
  if (accessScore < 80)
    recommendations.push(
      "Complete transcripts and consent notes before inviting a wider audience.",
    );
  if (durationSeconds > 2700)
    recommendations.push(
      "Offer a brief route for listeners with limited time.",
    );
  if (!recommendations.length)
    recommendations.push(
      "This listener profile has a balanced route with clear hand-offs.",
    );
  return {
    durationSeconds,
    comfortScore,
    accessScore,
    continuityScore,
    pressureSiteIds,
    recommendations,
  };
}
