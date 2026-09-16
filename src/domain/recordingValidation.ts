import type { Recording, RecordingDraft, ValidationError } from "./models";
import { createId, normalizeCatalogId } from "./ids";

const positive = (
  value: string,
  field: string,
  label: string,
): ValidationError | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? null
    : { field, message: `${label} must be a positive number.` };
};

export function validateRecordingDraft(
  draft: RecordingDraft,
  recordings: Recording[],
  existingId?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!draft.catalogId.trim())
    errors.push({ field: "catalogId", message: "Catalog ID is required." });
  if (
    recordings.some(
      (recording) =>
        normalizeCatalogId(recording.catalogId) ===
          normalizeCatalogId(draft.catalogId) && recording.id !== existingId,
    )
  )
    errors.push({ field: "catalogId", message: "Catalog ID must be unique." });
  if (!draft.title.trim())
    errors.push({ field: "title", message: "Clip title is required." });
  if (!draft.source.trim())
    errors.push({
      field: "source",
      message: "Recorder or source is required.",
    });
  if (!draft.recordedOn.trim())
    errors.push({
      field: "recordedOn",
      message: "Recording date is required.",
    });
  if (!draft.format.trim())
    errors.push({ field: "format", message: "File format is required." });
  if (!draft.location.trim())
    errors.push({ field: "location", message: "Location is required." });
  if (draft.summary.trim().length < 20)
    errors.push({
      field: "summary",
      message: "Add at least 20 characters describing the sound.",
    });
  const sample = positive(draft.sampleRate, "sampleRate", "Sample rate");
  if (sample) errors.push(sample);
  const duration = positive(
    draft.durationSeconds,
    "durationSeconds",
    "Duration",
  );
  if (duration) errors.push(duration);
  if (![1, 2].includes(Number(draft.channels)))
    errors.push({ field: "channels", message: "Channels must be 1 or 2." });
  if (![16, 24, 32].includes(Number(draft.bitDepth)))
    errors.push({
      field: "bitDepth",
      message: "Bit depth must be 16, 24, or 32.",
    });
  if (Number(draft.durationSeconds) > 900)
    errors.push({
      field: "durationSeconds",
      message: "Keep clips at 15 minutes or less.",
    });
  return errors;
}

export function recordingFromDraft(
  draft: RecordingDraft,
  existing?: Recording,
): Recording {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? createId("recording"),
    catalogId: normalizeCatalogId(draft.catalogId),
    title: draft.title.trim(),
    source: draft.source.trim(),
    recordedOn: draft.recordedOn.trim(),
    format: draft.format.trim(),
    location: draft.location.trim(),
    summary: draft.summary.trim(),
    audioSpec: {
      sampleRate: Number(draft.sampleRate),
      channels: Number(draft.channels) as 1 | 2,
      bitDepth: Number(draft.bitDepth) as 16 | 24 | 32,
      durationSeconds: Number(draft.durationSeconds),
    },
    signalRole: draft.signalRole,
    sensitivity: draft.sensitivity,
    transcriptStatus: draft.transcriptStatus,
    consentStatus: draft.consentStatus,
    isFeatured: draft.isFeatured,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    color: draft.color,
    importBatchId: existing?.importBatchId,
    lifecycle: existing?.lifecycle,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function draftFromRecording(recording: Recording): RecordingDraft {
  return {
    catalogId: recording.catalogId,
    title: recording.title,
    source: recording.source,
    recordedOn: recording.recordedOn,
    format: recording.format,
    location: recording.location,
    summary: recording.summary,
    sampleRate: String(recording.audioSpec.sampleRate),
    channels: String(recording.audioSpec.channels),
    bitDepth: String(recording.audioSpec.bitDepth),
    durationSeconds: String(recording.audioSpec.durationSeconds),
    signalRole: recording.signalRole,
    sensitivity: recording.sensitivity,
    transcriptStatus: recording.transcriptStatus,
    consentStatus: recording.consentStatus,
    isFeatured: recording.isFeatured,
    tags: recording.tags.join(", "),
    color: recording.color,
  };
}

export const emptyRecordingDraft: RecordingDraft = {
  catalogId: "",
  title: "",
  source: "",
  recordedOn: "",
  format: "WAV",
  location: "",
  summary: "",
  sampleRate: "48000",
  channels: "2",
  bitDepth: "24",
  durationSeconds: "120",
  signalRole: "texture",
  sensitivity: "public",
  transcriptStatus: "missing",
  consentStatus: "pending",
  isFeatured: false,
  tags: "",
  color: "#2f7c75",
};
