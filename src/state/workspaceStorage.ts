import type { StudyState } from "../domain/models";
import { createSeedStudy } from "./seed";
import { migrateWorkspace, validateReferences } from "./migrations";
import { readEnvelopePayload, writeWorkspaceEnvelope } from "./storageEnvelope";

export const STORAGE_KEY = "signal-commons.workspace.v1";
export const STORAGE_BACKUP_KEY = "signal-commons.workspace.backup.v1";

function readStoredStudy(raw: string | null): StudyState | null {
  const payload = readEnvelopePayload(raw);
  return payload ? migrateWorkspace(payload) : null;
}

/**
 * Loads the committed workspace, falling back from the checksummed primary
 * record to the last valid backup before using the sample study.
 */
export function loadStudy(
  storage: Pick<Storage, "getItem"> = localStorage,
): StudyState {
  try {
    const primary = readStoredStudy(storage.getItem(STORAGE_KEY));
    if (primary) return validateReferences(primary);
    const backup = readStoredStudy(storage.getItem(STORAGE_BACKUP_KEY));
    return backup ? validateReferences(backup) : createSeedStudy();
  } catch {
    return createSeedStudy();
  }
}

/**
 * Writes the workspace as a checksummed record, keeping the previous primary
 * record as the recovery backup. Returns false when storage is unavailable.
 */
export function saveStudy(
  state: StudyState,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): boolean {
  try {
    const previous = storage.getItem(STORAGE_KEY);
    if (previous) storage.setItem(STORAGE_BACKUP_KEY, previous);
    storage.setItem(STORAGE_KEY, writeWorkspaceEnvelope(state));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspace(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(STORAGE_BACKUP_KEY);
}
