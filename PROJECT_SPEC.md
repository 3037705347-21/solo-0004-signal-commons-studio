# Signal Commons Studio - Project Specification

## Goal

Signal Commons Studio is an offline-first browser workspace for community soundscape fieldwork. A field team curates short field recordings, composes a listening route across neighborhood sites, resolves consent and transcript findings, and compares listener scenarios before publishing a study pack.

## Users

- Field researchers catalogue recordings with capture context and audio metadata.
- Route editors arrange clips into a coherent listening route.
- Quality reviewers verify consent notes, transcripts, and listening support.
- Project leads use scenario projections to choose planning preferences.

## Core entities

- `FieldStudy`: title, field area, listening question, publication date, and release state.
- `Recording`: a short sound clip with catalogue ID, source, recording date, file format, capture location, audio specification, signal role, sensitivity, transcript status, and consent status.
- `Site`: a listening-route stop with a research prompt, duration and clip capacity, quiet-playback support, seating availability, and ordered recording IDs.
- `Placement`: assignment of a recording to a site and position in the route.
- `QualityIssue`: a severity-ranked evidence finding linked to a site or clip, with open, in-progress, or resolved state.
- `Snapshot`: a frozen release summary used for local export and comparison.
- `TeamMember`: a field colleague with a role and the visit dates they can cover.
- `ScheduleAssignment`: one dated, timed shift placing a team member at a listening site.
- `SchedulePlan`: the weekend date range, roster, and shifts the coverage engine derives gaps and overlaps from.

## Workflows

### 1. Curate the signal library

The user opens the library, searches and filters recordings, adds a recording through a validated editor, and sees it enter the study. Duplicate catalogue IDs, missing titles or capture context, invalid audio specifications, and weak summaries are rejected with field-level messages. The recording is persisted in local storage and becomes available to the route editor.

### 2. Compose and validate a listening route

The user opens the route view, selects an unplaced clip, assigns it to a listening site, changes sequence, and moves clips between sites. The domain engine recalculates site duration, clip utilization, signal-role coverage, and accessibility constraints after every transition. The constraint panel exposes blocking errors and warnings.

### 3. Resolve evidence quality before release

The user opens the quality desk, creates a finding linked to a clip or site, advances it through open, in-progress, and resolved states, and runs a release check. The release engine combines unresolved blockers, featured clip coverage, role coverage, and route validation. A passing study can export a JSON snapshot; a blocked study explains what remains.

### 4. Compare listener scenarios

The user opens the scenario lab and adjusts listening pace, listener count, and accessibility priority. The projection engine recomputes listening duration, comfort, access coverage, and pressure sites without mutating the saved study. The user can explicitly apply a scenario as planning preferences.

### 5. Export a field checklist

The user filters the quality desk by a listening site and downloads a CSV checklist that lists every placed clip in sequence with audio duration and unresolved findings.

### 6. Plan weekend field coverage

The user opens the field schedule, sets the weekend date range, builds a roster of colleagues with their available days, and assigns each colleague to a site and timed shift. After every change the coverage engine recomputes, for each day, which sites have no available colleague and which colleagues hold overlapping shifts. Assigning a colleague to a day they cannot cover is allowed but flagged, and the site stays marked uncovered until an available colleague is assigned. Schedule commands never modify recordings or a frozen release.

## State and rules

- Study state transitions are `draft -> review -> ready`; a blocking change regresses a ready study to `review`.
- Persisted state uses an explicit schema version, a monotonically increasing content revision, and a bounded command audit log.
- State-changing commands carry a command ID, origin tab, issue time, and expected revision. Repeated command IDs are idempotent, while stale revisions are rejected and recorded without changing content.
- Browser tabs synchronize committed workspace records through storage events and reload the checksummed primary or backup record.
- Version 1 browser data is migrated into the current schema; nested invalid records are rejected and dangling or duplicate route references are repaired during startup validation.
- Persistence writes a checksummed record plus the previous primary record as a backup. A corrupt or incomplete primary record falls back to the last valid backup before using sample data.
- Recording catalogue IDs are normalized and unique.
- Every recording must have positive sample rate, duration, and a valid channels or bit depth value.
- A site warns above 80% of listening capacity and blocks above 100%.
- Placement commands enforce site clip and duration limits before changing route state.
- Sensitive clips cannot enter a quiet-playback site without review.
- Featured clips must be assigned to a listening site before release.
- Arrival, texture, voice, and departure signals must all be represented in the route before release.
- Critical consent or editorial findings block release until resolved.
- A successful readiness check freezes a revision, deterministic content fingerprint, and snapshot; any release-relevant change marks that release stale and blocks export until another successful check.
- Each release has a monotonic sequence and records the prior release it supersedes, preserving a local release lineage.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.
- Schedule commands carry the same revision guards, command IDs, and audit trail as other commands, but they never regress a ready study or invalidate a frozen release and snapshot.
- Coverage is always computed for every day between the selected weekend start and end; date-only arithmetic is timezone-independent.
- A site is uncovered on a day when it has no shift staffed by a colleague available that day. A colleague with no selected visit days cannot cover any day; their existing shifts are all flagged unavailable and their sites become uncovered. A shift on a day its colleague cannot cover is flagged unavailable and does not count as cover.
- Two shifts for the same colleague on the same day whose times overlap are surfaced as conflicts; adjacent slots do not overlap and are allowed.
- Startup validation drops schedule shifts that reference removed colleagues, removed sites, or dates outside the selected weekend.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, route analysis, release rules, checklist serialization, and scenario projections.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `features/schedule`: weekend roster, timed site shifts, coverage matrix, and overlap feedback.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/schedule`, `/quality`, and `/scenarios`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- JSON snapshots use schema version 2 and include the frozen content revision, fingerprint, planning preferences, route summary, and unresolved findings.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, route constraints, release rules, deterministic fingerprints, reducer boundaries, site checklists, review transitions, versioned persistence, schedule coverage, and date-only math.
- Playwright browser checks for the five user-facing workflows.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Playwright checks that uncovered sites, unavailable colleagues, and overlapping shifts are visible immediately, survive reload, and leave a frozen release unchanged.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
