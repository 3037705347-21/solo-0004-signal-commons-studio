import { useEffect, useState, type RefObject } from "react";
import type { StudyState } from "../domain/models";
import type { StudyAction } from "./actions";
import { loadStudy, saveStudy, STORAGE_KEY } from "./persistence";

/**
 * Persists every committed workspace state and reports whether local storage
 * is healthy.
 */
export function usePersistentWorkspace(state: StudyState): boolean {
  const [storageHealthy, setStorageHealthy] = useState(true);

  useEffect(() => {
    setStorageHealthy(saveStudy(state));
  }, [state]);

  return storageHealthy;
}

/**
 * Decides whether a workspace record committed by another tab should replace
 * local state: older revisions never do, and the same revision only does when
 * it carries a different update timestamp.
 */
export function shouldAcceptIncomingWorkspace(
  incoming: StudyState,
  current: StudyState,
): boolean {
  if (incoming.revision < current.revision) return false;
  if (
    incoming.revision === current.revision &&
    incoming.updatedAt === current.updatedAt
  )
    return false;
  return true;
}

/**
 * Reloads committed workspace records written by other tabs. Stale or
 * identical records are ignored; newer records replace local state.
 */
export function useCrossTabWorkspaceSync(
  stateRef: RefObject<StudyState>,
  dispatch: (action: StudyAction) => void,
): void {
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const incoming = loadStudy();
      if (!shouldAcceptIncomingWorkspace(incoming, stateRef.current)) return;
      dispatch({ type: "workspace/sync", state: incoming });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
    // stateRef and dispatch are stable for the lifetime of the provider.
  }, []);
}
