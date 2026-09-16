import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  FileWarning,
  GitBranch,
  History,
  PencilLine,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Callout } from "../../components/Callout";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { TextField } from "../../components/TextField";
import { formatDate } from "../../domain/formatters";
import type {
  PendingRuleChange,
  RuleImpactItem,
  RuleImpactPreview,
  RuleSet,
  RuleVersion,
} from "../../domain/models";
import {
  fractionToPercent,
  percentToFraction,
  previewRuleImpact,
  selectActiveRuleVersion,
  validateRuleSet,
} from "../../domain/rules";
import { useStudy } from "../../state/StudyContext";

const POLICY_OPTIONS: Array<{
  value: RuleSet["sensitivePolicy"];
  label: string;
  detail: string;
}> = [
  {
    value: "allow",
    label: "Allow",
    detail: "Sensitive clips play anywhere without a finding.",
  },
  {
    value: "review-warning",
    label: "Warn & review",
    detail: "Non-quiet sites raise a warning until the plan is documented.",
  },
  {
    value: "block-placement",
    label: "Block placement",
    detail: "Sensitive clips can only be placed at quiet-playback sites.",
  },
];

const GATE_FIELDS: Array<{
  key: keyof Pick<
    RuleSet,
    | "requireFeaturedPlaced"
    | "requireAllRoles"
    | "requireCriticalResolved"
    | "requireNonEmptyRoute"
  >;
  label: string;
  detail: string;
}> = [
  {
    key: "requireNonEmptyRoute",
    label: "Route must contain clips",
    detail: "An empty listening route can never be released.",
  },
  {
    key: "requireFeaturedPlaced",
    label: "Featured clips placed",
    detail: "Every featured clip must be assigned to a listening site.",
  },
  {
    key: "requireAllRoles",
    label: "All signal roles represented",
    detail: "Arrival, texture, voice, and departure must appear in the route.",
  },
  {
    key: "requireCriticalResolved",
    label: "Critical findings resolved",
    detail: "Open critical consent or editorial findings block release.",
  },
];

const STATUS_META: Record<
  RuleImpactItem["status"],
  { tone: "danger" | "warning" | "positive" | "neutral"; label: string }
> = {
  "new-blocker": { tone: "danger", label: "New blocker" },
  "new-warning": { tone: "warning", label: "New warning" },
  "cleared-blocker": { tone: "positive", label: "Blocker clears" },
  "cleared-warning": { tone: "positive", label: "Warning clears" },
  unchanged: { tone: "neutral", label: "Unchanged" },
};

const IMPACT_ICONS = {
  site: GitBranch,
  recording: Sparkles,
  release: ShieldCheck,
};

export function RulesPage() {
  const { state, proposeRuleChange, adoptRuleChange, discardRuleChange } =
    useStudy();
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const active = selectActiveRuleVersion(state);
  const pending = state.pendingRuleChange;
  const history = useMemo(
    () => [...state.ruleVersions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [state.ruleVersions],
  );

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2800);
  };

  const adopt = (draft: Pick<PendingRuleChange, "label" | "note" | "rules">) => {
    const result = adoptRuleChange({ ...draft, createdAt: new Date().toISOString() });
    if (result.ok) {
      setEditorOpen(false);
      notify("Rule version adopted. New checks now use this basis.");
    } else {
      notify(result.message ?? "The draft could not be adopted.");
    }
  };

  const discard = () => {
    discardRuleChange();
    setEditorOpen(false);
    notify("Draft adjustment discarded; active rules are unchanged.");
  };

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="RULE VERSIONS"
        title="Study rule basis"
        description="Capacity, sensitive-audio, and release thresholds are versioned per study. Review the blast radius before a new draft takes effect."
        actions={
          <Button
            variant="primary"
            icon={<PencilLine size={16} />}
            onClick={() => setEditorOpen(true)}
          >
            {pending ? "Review draft adjustment" : "Propose adjustment"}
          </Button>
        }
      />

      {pending && (
        <Callout
          tone="warning"
          title="A rule adjustment is awaiting confirmation"
          actions={
            <div className="callout-button-row">
              <Button
                variant="primary"
                icon={<Check size={15} />}
                onClick={() => setEditorOpen(true)}
              >
                Review &amp; adopt
              </Button>
              <Button variant="ghost" icon={<Trash2 size={15} />} onClick={discard}>
                Discard
              </Button>
            </div>
          }
        >
          Draft “{pending.label}” does not change any evaluation yet. Route
          constraints and the release gate keep using “{active.label}” until
          the draft is adopted.
        </Callout>
      )}

      <ActiveRuleCard version={active} releaseLabel={state.release?.ruleLabel} />

      <section className="rules-history" aria-label="Rule version history">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">VERSION LINEAGE</div>
            <h2>Rule versions</h2>
          </div>
          <History size={19} />
        </div>
        <div className="rule-timeline">
          {history.map((version) => (
            <RuleVersionRow
              key={version.id}
              version={version}
              isActive={version.id === state.activeRuleVersionId}
            />
          ))}
        </div>
      </section>

      {editorOpen && (
        <RuleEditor
          active={active}
          pending={pending}
          onClose={() => setEditorOpen(false)}
          onSaveDraft={(draft) => {
            const result = proposeRuleChange(draft);
            if (!result.ok) return result;
            notify("Draft saved. Review the impact, then adopt when ready.");
            return result;
          }}
          onAdopt={(draft) => adopt(draft)}
        />
      )}

      {notice && (
        <div className="toast toast-positive">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

function ActiveRuleCard({
  version,
  releaseLabel,
}: {
  version: RuleVersion;
  releaseLabel?: string;
}) {
  const rules = version.rules;
  return (
    <section className="active-rule-card" aria-label="Active rule version">
      <div className="active-rule-head">
        <div>
          <div className="eyebrow">ACTIVE RULE VERSION</div>
          <h2>{version.label}</h2>
          <p className="rule-note">{version.note}</p>
        </div>
        <div className="active-rule-meta">
          <Badge tone="positive">In force</Badge>
          <span className="rule-effective">
            <Clock3 size={13} /> Effective {formatDate(version.effectiveFrom)}
          </span>
        </div>
      </div>
      <div className="rule-summary-grid">
        <RuleSummary
          title="Capacity"
          lines={[
            `Warn at ${fractionToPercent(rules.capacityWarnAt)}% of site target`,
            `Block at ${fractionToPercent(rules.capacityBlockAt)}% of site target`,
            `Clips up to ${Math.round(rules.maxClipSeconds / 60)} minutes`,
          ]}
        />
        <RuleSummary
          title="Sensitive audio"
          lines={[
            POLICY_OPTIONS.find((option) => option.value === rules.sensitivePolicy)
              ?.label ?? rules.sensitivePolicy,
            "Applies to sensitive clips at non-quiet sites",
          ]}
        />
        <RuleSummary
          title="Release gate"
          lines={GATE_FIELDS.filter((field) => rules[field.key]).map(
            (field) => field.label,
          )}
        />
      </div>
      {releaseLabel && releaseLabel !== version.label && (
        <div className="frozen-release-note">
          <FileWarning size={14} />
          <span>
            The last published snapshot was frozen under <strong>{releaseLabel}</strong> and
            still displays under that historical basis.
          </span>
        </div>
      )}
    </section>
  );
}

function RuleSummary({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rule-summary">
      <div className="eyebrow">{title}</div>
      <ul>
        {lines.map((line) => (
          <li key={line}>
            <Check size={12} /> {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleVersionRow({
  version,
  isActive,
}: {
  version: RuleVersion;
  isActive: boolean;
}) {
  return (
    <article className={`rule-version-row ${isActive ? "active" : ""}`}>
      <div className="rule-version-marker">
        {isActive ? <ShieldCheck size={16} /> : <Clock3 size={16} />}
      </div>
      <div className="rule-version-body">
        <div className="rule-version-title">
          <h3>{version.label}</h3>
          {isActive && <Badge tone="positive">Active</Badge>}
        </div>
        <p>{version.note}</p>
        <div className="rule-version-meta">
          <span>
            <Clock3 size={12} /> {formatDate(version.effectiveFrom)}
          </span>
          <span>
            <Eye size={12} />{" "}
            {fractionToPercent(version.rules.capacityWarnAt)}/
            {fractionToPercent(version.rules.capacityBlockAt)}% capacity
          </span>
          <span>
            <AlertTriangle size={12} />{" "}
            {POLICY_OPTIONS.find(
              (option) => option.value === version.rules.sensitivePolicy,
            )?.label ?? version.rules.sensitivePolicy}
          </span>
        </div>
      </div>
    </article>
  );
}

interface RuleDraftForm {
  label: string;
  note: string;
  capacityWarnPercent: string;
  capacityBlockPercent: string;
  maxClipMinutes: string;
  sensitivePolicy: RuleSet["sensitivePolicy"];
  requireFeaturedPlaced: boolean;
  requireAllRoles: boolean;
  requireCriticalResolved: boolean;
  requireNonEmptyRoute: boolean;
}

function formFromRules(
  rules: RuleSet,
  label = "",
  note = "",
): RuleDraftForm {
  return {
    label,
    note,
    capacityWarnPercent: String(fractionToPercent(rules.capacityWarnAt)),
    capacityBlockPercent: String(fractionToPercent(rules.capacityBlockAt)),
    maxClipMinutes: String(Math.round(rules.maxClipSeconds / 60)),
    sensitivePolicy: rules.sensitivePolicy,
    requireFeaturedPlaced: rules.requireFeaturedPlaced,
    requireAllRoles: rules.requireAllRoles,
    requireCriticalResolved: rules.requireCriticalResolved,
    requireNonEmptyRoute: rules.requireNonEmptyRoute,
  };
}

function rulesFromForm(form: RuleDraftForm): RuleSet {
  return {
    capacityWarnAt: percentToFraction(form.capacityWarnPercent),
    capacityBlockAt: percentToFraction(form.capacityBlockPercent),
    maxClipSeconds: Math.round(Number(form.maxClipMinutes) * 60),
    sensitivePolicy: form.sensitivePolicy,
    requireFeaturedPlaced: form.requireFeaturedPlaced,
    requireAllRoles: form.requireAllRoles,
    requireCriticalResolved: form.requireCriticalResolved,
    requireNonEmptyRoute: form.requireNonEmptyRoute,
  };
}

function RuleEditor({
  active,
  pending,
  onClose,
  onSaveDraft,
  onAdopt,
}: {
  active: RuleVersion;
  pending: PendingRuleChange | null;
  onClose: () => void;
  onSaveDraft: (
    draft: Pick<PendingRuleChange, "label" | "note" | "rules">,
  ) => { ok: boolean; errors?: Record<string, string> };
  onAdopt: (
    draft: Pick<PendingRuleChange, "label" | "note" | "rules">,
  ) => void;
}) {
  const [form, setForm] = useState<RuleDraftForm>(() =>
    pending
      ? formFromRules(pending.rules, pending.label, pending.note)
      : formFromRules(active.rules),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = <K extends keyof RuleDraftForm>(
    key: K,
    value: RuleDraftForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const candidateRules = useMemo(() => {
    try {
      return rulesFromForm(form);
    } catch {
      return null;
    }
  }, [form]);

  const ruleSetErrors = candidateRules ? validateRuleSet(candidateRules) : [];
  const { state } = useStudy();
  const preview: RuleImpactPreview | null = useMemo(() => {
    if (!candidateRules || ruleSetErrors.length) return null;
    try {
      return previewRuleImpact(state, candidateRules);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateRules, state.recordings, state.sites, state.issues]);

  const sameAsActive =
    candidateRules !== null &&
    JSON.stringify(candidateRules) === JSON.stringify(active.rules);

  const collectErrors = () => {
    const nextErrors: Record<string, string> = {};
    ruleSetErrors.forEach((error) => {
      nextErrors[error.field] = error.message;
    });
    if (!form.label.trim()) nextErrors.label = "Name this rule version.";
    if (form.note.trim().length < 12)
      nextErrors.note = "Explain why the thresholds are changing.";
    setErrors(nextErrors);
    return nextErrors;
  };

  const saveDraft = () => {
    if (!candidateRules || Object.keys(collectErrors()).length) return;
    const result = onSaveDraft({
      label: form.label,
      note: form.note,
      rules: candidateRules,
    });
    if (!result.ok) setErrors(result.errors ?? {});
  };

  return (
    <Modal
      eyebrow={pending ? "REVIEW DRAFT ADJUSTMENT" : "PROPOSE RULE ADJUSTMENT"}
      title={
        pending
          ? `Review “${pending.label}”`
          : "Adjust the study rule basis"
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" icon={<Check size={15} />} onClick={saveDraft}>
            Save draft
          </Button>
          <Button
            variant="primary"
            icon={<ArrowRight size={15} />}
            onClick={() => {
              if (!candidateRules || Object.keys(collectErrors()).length) return;
              onAdopt({
                label: form.label,
                note: form.note,
                rules: candidateRules,
              });
            }}
          >
            Adopt now
          </Button>
        </>
      }
    >
      <div className="rule-editor-stack">
        <Callout tone="info" title="Nothing changes until you confirm">
          Drafts are held aside and audited. Only after “Adopt” do route
          constraints and release checks use the new thresholds; published
          snapshots remain frozen under their original rules.
        </Callout>

        <div className="form-grid">
          <TextField
            label="Version name"
            value={form.label}
            onChange={(event) => update("label", event.target.value)}
            error={errors.label}
            placeholder="e.g. Winter pilot thresholds"
          />
          <TextField
            label="Reason for change"
            value={form.note}
            onChange={(event) => update("note", event.target.value)}
            error={errors.note}
            placeholder="Why are these thresholds changing for this study?"
          />
        </div>

        <div className="panel-heading">
          <div>
            <div className="eyebrow">SITE CAPACITY</div>
            <h3>Listening limits</h3>
          </div>
        </div>
        <div className="rule-threshold-grid">
          <ThresholdField
            label="Warn at"
            suffix="% of target"
            value={form.capacityWarnPercent}
            onChange={(value) => update("capacityWarnPercent", value)}
            error={errors.capacityWarnAt}
            min={1}
            max={100}
          />
          <ThresholdField
            label="Block at"
            suffix="% of target"
            value={form.capacityBlockPercent}
            onChange={(value) => update("capacityBlockPercent", value)}
            error={errors.capacityBlockAt}
            min={1}
            max={100}
          />
          <ThresholdField
            label="Longest clip"
            suffix="minutes"
            value={form.maxClipMinutes}
            onChange={(value) => update("maxClipMinutes", value)}
            error={errors.maxClipSeconds}
            min={1}
            max={30}
          />
        </div>

        <div className="panel-heading">
          <div>
            <div className="eyebrow">SENSITIVE AUDIO</div>
            <h3>Sensitive clips at non-quiet sites</h3>
          </div>
        </div>
        <div className="policy-options">
          {POLICY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`policy-option ${
                form.sensitivePolicy === option.value ? "selected" : ""
              }`}
              onClick={() => update("sensitivePolicy", option.value)}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
        {errors.sensitivePolicy && (
          <span className="field-error">{errors.sensitivePolicy}</span>
        )}

        <div className="panel-heading">
          <div>
            <div className="eyebrow">RELEASE GATE</div>
            <h3>Conditions required to publish</h3>
          </div>
        </div>
        <div className="gate-toggle-list">
          {GATE_FIELDS.map((field) => (
            <label className="gate-toggle" key={field.key}>
              <input
                type="checkbox"
                checked={form[field.key]}
                onChange={(event) => update(field.key, event.target.checked)}
              />
              <span>
                <strong>{field.label}</strong>
                <small>{field.detail}</small>
              </span>
            </label>
          ))}
        </div>

        <ImpactPreview preview={preview} sameAsActive={sameAsActive} />
      </div>
    </Modal>
  );
}

function ThresholdField({
  label,
  suffix,
  value,
  onChange,
  error,
  min,
  max,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  min: number;
  max: number;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="threshold-input">
        <input
          type="number"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="threshold-suffix">{suffix}</span>
      </div>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function ImpactPreview({
  preview,
  sameAsActive,
}: {
  preview: RuleImpactPreview | null;
  sameAsActive: boolean;
}) {
  if (!preview) return null;
  const releaseBefore = preview.beforeRelease.ready;
  const releaseAfter = preview.afterRelease.ready;
  return (
    <section className="impact-preview" aria-label="Rule change impact">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">IMPACT PREVIEW</div>
          <h3>What this adjustment would change</h3>
        </div>
        <Eye size={19} />
      </div>
      <div className="impact-summary">
        <ImpactStat
          label="Sites affected"
          value={preview.affectedSiteCount}
        />
        <ImpactStat
          label="Recordings affected"
          value={preview.affectedRecordingCount}
        />
        <div className="impact-gate">
          <span className="eyebrow">RELEASE GATE</span>
          <div className="impact-gate-flow">
            <Badge tone={releaseBefore ? "positive" : "danger"}>
              {releaseBefore ? "Passes" : "Blocked"}
            </Badge>
            <ArrowRight size={14} />
            <Badge tone={releaseAfter ? "positive" : "danger"}>
              {releaseAfter ? "Passes" : "Blocked"}
            </Badge>
            <span className="impact-score">
              score {preview.beforeRelease.score} → {preview.afterRelease.score}
            </span>
          </div>
        </div>
      </div>

      {sameAsActive && preview.items.length === 0 ? (
        <div className="impact-empty">
          <CheckCircle2 size={16} />
          These thresholds match the active rule version.
        </div>
      ) : preview.items.length === 0 ? (
        <div className="impact-empty">
          <CheckCircle2 size={16} />
          No site, recording, or release result changes under these thresholds.
        </div>
      ) : (
        <ul className="impact-list">
          {preview.items.map((item) => (
            <ImpactRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ImpactStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="impact-stat">
      <strong>{value}</strong>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function ImpactRow({ item }: { item: RuleImpactItem }) {
  const Icon = IMPACT_ICONS[item.kind];
  const meta = STATUS_META[item.status];
  const toneClass =
    meta.tone === "danger"
      ? "text-danger"
      : meta.tone === "warning"
        ? "text-amber"
        : meta.tone === "positive"
          ? "text-teal"
          : "";
  return (
    <li className="impact-row">
      <Icon size={15} />
      <div className="impact-row-body">
        <div className="impact-row-title">
          <strong>{item.label}</strong>
          <Badge tone={meta.tone === "neutral" ? "neutral" : meta.tone}>
            {meta.label}
          </Badge>
        </div>
        <small className={toneClass}>{item.detail}</small>
      </div>
    </li>
  );
}
