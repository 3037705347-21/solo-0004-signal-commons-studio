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
- `Recording`: a short sound clip with catalogue ID, source, recording date, file format, capture location, audio specification, signal role, sensitivity, transcript status, and a denormalized consent headline derived from the consent ledger.
- `ConsentGrant`: an append-only consent decision for a recording recording its lifecycle status (active, restricted, withdrawn), authorized purposes (listening route, transcript/captions, public archive), granting party, capture channel, evidence reference, scope note, grant date, and optional expiry date. Narrowing scope or withdrawing consent appends a newer grant.
- `Site`: a listening-route stop with a research prompt, duration and clip capacity, quiet-playback support, seating availability, and ordered recording IDs.
- `Placement`: assignment of a recording to a site and position in the route.
- `QualityIssue`: a severity-ranked evidence finding linked to a site or clip, with open, in-progress, or resolved state.
- `Snapshot`: a frozen release summary used for local export and comparison, including the consent ledger and the per-clip consent basis under which it shipped.

## Workflows

### 1. Curate the signal library

The user opens the library, searches and filters recordings, adds a recording through a validated editor, and sees it enter the study. Duplicate catalogue IDs, missing titles or capture context, invalid audio specifications, and weak summaries are rejected with field-level messages. The recording is persisted in local storage and becomes available to the route editor.

### 2. Compose and validate a listening route

The user opens the route view, selects an unplaced clip, assigns it to a listening site, changes sequence, and moves clips between sites. The domain engine recalculates site duration, clip utilization, signal-role coverage, and accessibility constraints after every transition. The constraint panel exposes blocking errors and warnings.

### 3. Resolve evidence quality before release

The user opens the quality desk, creates a finding linked to a clip or site, advances it through open, in-progress, and resolved states, and runs a release check. The release engine combines unresolved blockers, featured clip coverage, role coverage, and route validation. A passing study can export a JSON snapshot; a blocked study explains what remains.

### 3b. Manage consent through its lifecycle

The user opens the consent ledger, records a grant with granting party, capture channel, evidence reference, authorized purposes, and optional expiry, and sees each clip's current standing and linked sites. A withdrawal or scope restriction appends a new ledger decision. The change propagates immediately: route analysis and placement checks block withdrawn, expired, or out-of-scope clips; field checklists show the current consent standing and evidence; pending releases are marked stale and fail their next check. Already published releases keep the consent basis frozen in their snapshot; expired or withdrawn consent can never authorize new content or new releases.

### 4. Compare listener scenarios

The user opens the scenario lab and adjusts listening pace, listener count, and accessibility priority. The projection engine recomputes listening duration, comfort, access coverage, and pressure sites without mutating the saved study. The user can explicitly apply a scenario as planning preferences.

### 5. Export a field checklist

The user filters the quality desk by a listening site and downloads a CSV checklist that lists every placed clip in sequence with audio duration and unresolved findings.

## State and rules

- Study state transitions are `draft -> review -> ready`; a blocking change regresses a ready study to `review`.
- Persisted state uses an explicit schema version, a monotonically increasing content revision, and a bounded command audit log.
- State-changing commands carry a command ID, origin tab, issue time, and expected revision. Repeated command IDs are idempotent, while stale revisions are rejected and recorded without changing content.
- Browser tabs synchronize committed workspace records through storage events and reload the checksummed primary or backup record.
- Version 1 and version 2 browser data is migrated into the current schema; nested invalid records are rejected, grants for missing recordings are dropped, and dangling or duplicate route references are repaired during startup validation.
- Persistence writes a checksummed record plus the previous primary record as a backup. A corrupt or incomplete primary record falls back to the last valid backup before using sample data.
- Recording catalogue IDs are normalized and unique.
- Pre-ledger consent statuses are synthesized into equivalent ledger grants during migration: confirmed and restricted clips receive a matching grant, and pending clips start with no ledger entry.
- Every recording must have positive sample rate, duration, and a valid channels or bit depth value.
- A site warns above 80% of listening capacity and blocks above 100%.
- Placement commands enforce site clip and duration limits before changing route state.
- Sensitive clips cannot enter a quiet-playback site without review.
- Featured clips must be assigned to a listening site before release.
- Arrival, texture, voice, and departure signals must all be represented in the route before release.
- Critical consent or editorial findings block release until resolved.
- Consent is an append-only ledger of purpose-scoped grants with provenance and expiry. The latest in-force grant governs a clip; a withdrawn grant authorizes no purposes, and an expired grant lapses on the day after its expiry date.
- Withdrawn, expired, or route-excluded consent blocks new placements and new release content; route consent that excludes the public archive is a non-blocking caution. Linked sites, checklists, and release judgments are derived live from the ledger.
- Published releases are immutable evidence: snapshots freeze the consent ledger and each placed clip's resolved consent basis, which remains valid for that release even after later withdrawal or expiry.
- A successful readiness check freezes a revision, deterministic content fingerprint, consent basis, and snapshot; any release-relevant change marks that release stale and blocks export until another successful check.
- Each release has a monotonic sequence and records the prior release it supersedes, preserving a local release lineage.
- Scenario calculations are derived UI state and never overwrite the saved study unless explicitly applied.

## Modules and dependency direction

- `app`: application composition, routing, shell, and page entry points.
- `domain`: entities, validation, state transitions, consent lifecycle and impact, route analysis, release rules, checklist serialization, and scenario projections.
- `state`: revision-guarded commands, reducer, audit log, cross-tab synchronization, checksummed persistence and recovery, migrations, seed study, and selectors.
- `features/library`: signal library discovery, filtering, creation, and editing.
- `features/route`: listening-site planning, placement transitions, and constraint feedback.
- `features/consent`: consent ledger, scope and expiry management, withdrawal, and propagation impact.
- `features/quality`: evidence finding lifecycle, field checklist export, release gate, and snapshot export.
- `features/scenarios`: non-mutating listener scenario projection and preference application.
- `components`: shared navigation, forms, dialogs, feedback, metrics, and visual primitives.

## Public interfaces

- Browser routes: `/library`, `/route`, `/consent`, `/quality`, and `/scenarios`.
- `StudyProvider` exposes typed commands and derived state to pages.
- Local persistence key: `signal-commons.workspace.v1`.
- Recovery backup key: `signal-commons.workspace.backup.v1`.
- JSON snapshot download: `signal-commons-snapshot-<date>.json`.
- Field checklist download: `signal-commons-route-checklist-<site>-<date>.csv`.
- JSON snapshots use schema version 3 and include the frozen content revision, fingerprint, planning preferences, route summary, consent ledger, per-clip consent basis, and unresolved findings. Schema version 2 snapshots remain readable as frozen historical evidence.

## Validation plan

- TypeScript compilation and Vite production build.
- Vitest tests for recording validation, consent ledger resolution and impact, route constraints, release rules with consent gating, deterministic fingerprints, reducer boundaries, site checklists, review transitions, and versioned persistence.
- Playwright browser checks for the user-facing workflows, including withdrawal propagation and scope narrowing on the consent ledger.
- Playwright checks that invalid capacity placements are rejected before route state changes.
- Playwright checks that committed workspace changes propagate to a second browser tab.
- Generic project audit verifies source scale, manifest consistency, and every declared workflow command.

## Intentionally omitted

- Multi-user collaboration and remote synchronization.
- Authentication, server APIs, and cloud storage.
- Continuous audio capture or waveform editing.
- External catalog integrations and geospatial map tiles.
