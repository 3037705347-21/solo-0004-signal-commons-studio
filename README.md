# Signal Commons Studio

Signal Commons Studio is an offline-first React workspace for community soundscape fieldwork. Field researchers curate short recordings, route editors arrange clips into listening sites, reviewers resolve consent and transcript findings, and teams compare listener scenarios before exporting a study snapshot.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The study is persisted in browser local storage under `signal-commons.workspace.v1`; the storage key is retained for compatibility while stored documents migrate to the current schema. A checksummed previous record is retained under `signal-commons.workspace.backup.v1` for recovery, and committed changes synchronize across open tabs. No network services or environment variables are required. Use the sidebar **Reset sample study** action to restore the built-in study.

## Validation commands

```bash
npm run build
npm run test
npm run test:e2e
npm run check
```

## Directory structure

- `src/domain`: recording models and validation, route analysis, review transitions, release rules, checklist serialization, and listener projections.
- `src/state`: typed commands, revision guards, reducer, versioned migrations, audit log, cross-tab synchronization, checksummed persistence, seed study, and undo history.
- `src/features/library`: searchable signal library and validated recording editor.
- `src/features/route`: listening-site planning, placement transitions, and constraint feedback.
- `src/features/quality`: evidence finding lifecycle, site field checklists, release gate, and snapshot export.
- `src/features/scenarios`: non-mutating listener scenario controls and derived metrics.
- `src/components`: shared shell, navigation, forms, badges, metrics, dialogs, and visual primitives.

## Inputs and outputs

- Recording entries accept a catalogue ID, title, recorder or source, recording date, file format, capture location, audio specification, signal role, sensitivity, transcript status, consent status, tags, and listening summary.
- Quality findings accept severity, owner, optional site or clip links, and decision context.
- A successful release check enables a JSON file named `signal-commons-snapshot-YYYY-MM-DD.json` containing the study, recordings, listening sites, summary metrics, and unresolved non-blocking findings.
- Selecting a listening site on the quality desk shows a field recording checklist that can be downloaded as CSV.

State-changing page actions call typed workspace commands. Commands validate at the boundary, enforce route capacity, carry revision guards, dispatch reducer events, and persist a checksummed recoverable record. Repeated commands are idempotent, stale revisions are rejected, and committed changes synchronize across tabs. Readiness checks freeze a revision, deterministic study fingerprint, and release lineage; later changes mark the frozen release stale. Derived route and scenario analysis is pure and recalculates without mutating saved data.
