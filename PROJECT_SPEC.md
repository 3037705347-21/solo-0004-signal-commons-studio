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
- `HandoffPacket`: a portable offline handover record with outgoing/incoming colleagues, a frozen session baseline, derived change list, unfinished items, and accept/decline decision history.

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

### 6. Hand off offline work between colleagues

Before an offline session, the outgoing worker opens the handoff desk and starts a session, which captures a baseline revision and entity-id snapshot. They complete recordings, placements, and findings normally. When handing the shared browser to the next colleague, they prepare a handoff packet: both parties sign the record (outgoing and incoming names), the engine derives the full change list against the baseline (clips added/edited/removed, placements added/removed/reordered, findings added/updated/removed), and unfinished items with severity are attached. The packet is downloadable as a portable JSON list or a printable, signable Markdown checklist. Once prepared, the entire study is frozen until the receiver decides — no clip may be added, renamed, edited, or removed, and no placement, finding, or planning preference may change — so the confirmed checklist can never drift from what is actually taken over. If the outgoing worker needs to fold in more work, they withdraw the packet (it stays in history as `withdrawn` and the session reopens), make the changes, and prepare a fresh packet that the receiver re-confirms. The receiver reviews the same checklist, then accepts (scope enters normal release judgment and the items become traceable to that packet forever) or declines (content introduced only by that session is rolled back). Every packet keeps a monotonic sequence and the id of the previously accepted packet, and a provenance index traces each introduced clip and finding back to its handoff.

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
- Handoff sessions capture a revision-bound baseline; preparing a packet freezes derived changes, unfinished items, and the revision range into a monotonic, append-only handoff history.
- New clips and findings introduced during a handoff session carry the packet id as provenance. Provenance is excluded from the release fingerprint.
- A prepared packet freezes all study content (clips, placements, findings, and preferences) until the receiver accepts or declines, or the outgoing worker withdraws it; readiness cannot pass while a session is open or a packet is pending, and pending-packet content is excluded from release analysis.
- Withdrawing a pending packet marks it `withdrawn` in history, strips its provenance tags, and reopens the session baseline so further changes are folded into a freshly prepared, re-confirmed packet.
- Accepting a packet releases its scope into normal judgment; declining it removes the clips and findings introduced only by that session (inherited baseline content is preserved) and marks the packet declined in history.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, route analysis, release rules, checklist serialization, and scenario projections.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, handoff session state, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `features/handoff`: offline session baseline, portable handover checklist, receiver accept/decline, quarantine gating, and provenance history.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/quality`, `/scenarios`, and `/handoff`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- Portable handoff download: `signal-commons-handoff-<sequence>-<date>.json` (plus a `.md` printable checklist).
- JSON snapshots use schema version 2 and include the frozen content revision, fingerprint, planning preferences, route summary, and unresolved findings.
- Portable handoff lists use schema version 1, are tagged `signal-commons-handoff`, and embed the full packet, study title/area, and change totals.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, route constraints, release rules, deterministic fingerprints, reducer boundaries, site checklists, review transitions, versioned persistence, handoff change derivation, quarantine, accept/decline lifecycle, and portable checklist serialization.
- Playwright browser checks for the five user-facing workflows.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Playwright checks that a prepared handoff quarantines new content from release until the receiver accepts it, that no clip, placement, finding, or preference can change while the packet awaits confirmation, and that declining rolls the session's new clip out of the study; withdrawing a packet reopens the session so a re-prepared packet lists every later change.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
