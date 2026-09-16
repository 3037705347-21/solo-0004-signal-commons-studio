import type { StudyState } from "../domain/models";

export const STORAGE_ENVELOPE_VERSION = 1;

export interface StorageEnvelope {
  storageVersion: typeof STORAGE_ENVELOPE_VERSION;
  checksum: string;
  stateJson: string;
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Serializes a workspace state into the checksummed storage envelope.
 */
export function writeWorkspaceEnvelope(state: StudyState): string {
  const stateJson = JSON.stringify(state);
  const envelope: StorageEnvelope = {
    storageVersion: STORAGE_ENVELOPE_VERSION,
    checksum: fnv1a(stateJson),
    stateJson,
  };
  return JSON.stringify(envelope);
}

/**
 * Reads a stored record back into its raw workspace payload. Enveloped records
 * must carry a matching checksum; legacy unenveloped JSON passes through so
 * migrations can handle it. Corrupt or tampered records return null.
 */
export function readEnvelopePayload(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as Partial<StorageEnvelope>).storageVersion ===
        STORAGE_ENVELOPE_VERSION
    ) {
      const envelope = parsed as Partial<StorageEnvelope>;
      if (
        typeof envelope.stateJson !== "string" ||
        typeof envelope.checksum !== "string" ||
        fnv1a(envelope.stateJson) !== envelope.checksum
      )
        return null;
      return JSON.parse(envelope.stateJson);
    }
    return parsed;
  } catch {
    return null;
  }
}
