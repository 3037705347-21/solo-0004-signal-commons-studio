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

## State and rules

- Study state transitions are `draft -> review -> ready`; a blocking change regresses a ready study to `review`.
- Persisted state uses an explicit schema version, a monotonically increasing content revision, and a bounded command audit log.
- State-changing commands carry a command ID, origin tab, issue time, and expected revision. Repeated command IDs are idempotent, while stale revisions are rejected and recorded without changing content.
- Browser tabs synchronize committed workspace records through storage events and reload the checksummed primary or backup record.
- Version 1 and version 2 browser data is migrated into the current schema (version 3): lifecycle metadata and a legacy import batch are back-filled, nested invalid records are rejected, and dangling or duplicate route references are repaired during startup validation while tombstone- and snapshot-backed references are preserved.
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
- Each release has a monotonic sequence and records the prior release it supersedes, preserving a local release lineage. Superseded releases move into a retained history with their snapshots embedded.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.

## Retention policy

- Every business category runs on an executable, fixed-day retention window measured from a stored anchor: active library clips 180 days, import batches 90 days, listening sites 365 days, quality findings 120 days, and published release versions 1095 days.
- Each record is reported as `within-retention`, `expired` (window elapsed, still live and eligible to archive), or `archived` (parked out of workflows).
- Archival removes clips, sites, and findings from route analysis, scenario projection, checklists, snapshots, and the release gate, but the record and its id stay in the workspace. An archived clip cannot be parked while it is still placed on an active listening site.
- Physical purge is only allowed from the archived state. A clip embedded in any published release snapshot is protected from purge.
- Purge leaves a tombstone and never deletes references: route placement lists, quality findings, import batch manifests, and frozen releases continue to resolve the cleaned id to a stub labeled with the record name, purge time, reason, and the release versions that still cite it. Frozen snapshots embed full copies of the clips and sites they shipped, so an old release resolves its content even after the live records are gone.
- Quality findings are never cascade-deleted when a linked site or clip is cleaned. They keep both links, resolve through the tombstone, remain visible in the quality desk (including a "Cleaned sites" filter group), and stop participating in the release gate once everything they cite is no longer live.
- Archived records can be restored. Restore re-arms the retention window from the restore instant, re-links prior references, returns a ready project to review, marks the frozen release stale, and blocks export until a fresh readiness check passes.
- A retention sweep archives expired, unprotected material and purges already-archived, unprotected material in one revision-guarded command; it never purges a record in the same run that first archives it, and protected records are reported as skipped.
- Import batches are retained lineage records: their manifests (source, import time, and the full delivered clip id list) outlive their clips, so cleaned clips still appear in the batch that delivered them.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, route analysis, release rules, checklist serialization, scenario projections, retention policy and lifecycle, and the reference-resolution registry.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `features/retention`: retention reporting, archive/restore/purge controls, sweep execution, import batch lineage, and release lineage review.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/quality`, `/scenarios`, and `/retention`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- JSON snapshots use schema version 2 and include the frozen content revision, fingerprint, planning preferences, route summary, and unresolved findings.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, route constraints, release rules, deterministic fingerprints, reducer boundaries, site checklists, review transitions, and versioned persistence.
- Playwright browser checks for the five user-facing workflows.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
