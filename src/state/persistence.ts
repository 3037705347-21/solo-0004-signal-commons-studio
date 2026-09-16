/**
 * Persistence facade: keeps the public entry points stable while the
 * implementation is split into the checksum envelope codec
 * (`storageEnvelope`), workspace record recovery (`workspaceStorage`), and
 * review UI preferences (`reviewUiStorage`).
 */
export {
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
  loadStudy,
  saveStudy,
  clearWorkspace,
} from "./workspaceStorage";
export {
  REVIEW_UI_KEY,
  loadReviewUi,
  saveReviewUi,
  type ReviewUiState,
} from "./reviewUiStorage";
