# Signal Commons Studio

Signal Commons Studio is an offline-first React workspace for community soundscape fieldwork. Field researchers curate short recordings, route editors arrange clips into listening sites, reviewers resolve consent and transcript findings, and teams compare listener scenarios before exporting a study snapshot.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The study is persisted in browser local storage under `signal-commons.workspace.v1`; the storage key is retained for compatibility while stored documents migrate to the current schema. A checksummed previous record is retained under `signal-commons.workspace.backup.v1` for recovery, and committed changes synchronize across open tabs. A field batch under review is kept separately under `signal-commons.batch-draft.v1` so reopening the app restores the reviewer's exact step without committing anything. No network services or environment variables are required. Use the sidebar **Reset sample study** action to restore the built-in study.

## Importing a returning field batch

Field material arriving together is handled through **Library → Import batch**:

1. Paste the field team's JSON (or choose a `.json` file). Sections: `recordings` (each may carry an embedded `site`/`position`), standalone `placements`, and `issues`; an optional `batchId` and `label` identify the shipment.
2. Choose **Review batch**. Every row is checked against the same rules as the single-clip editor (unique normalized catalogue IDs, complete capture context, valid audio spec, site clip/duration limits, sensitive-clip guidance, finding ownership and context) with results visible per row. Rows matching an already-received entity are marked **duplicate** rather than blocked. If a section of the file itself is unreadable (a section that is not a list, a record that is not an object, or a scalar field holding a list/object), the readable rows still open in review but the defect is listed as a **file error** showing its exact location; receipt stays blocked until the source JSON is repaired and reviewed again.
3. The **Receive** action stays disabled while any row fails or any file error remains; inline editing fixes row problems without leaving the dialog, while file errors require **Back to source to repair**.
4. On receipt the whole batch lands as one revision-guarded command — recordings, route positions, and findings together. If any row still violates a rule (or a file error remains) at commit time, the reducer throws and no collection is replaced, so a failed or partly unreadable batch can never leave half-imported data.

The batch is identified by its explicit `batchId` (or a deterministic content fingerprint when absent). Recordings, (clip, site) positions, and findings carry deterministic batch-derived IDs and natural-key checks, so resubmitting the same shipment replays the same command and never duplicates a clip, route position, or finding. Each receipt is recorded in the workspace import ledger.

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
