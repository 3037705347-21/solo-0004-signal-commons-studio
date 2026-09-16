/**
 * FNV-1a 32-bit string hash, rendered as an 8-character lowercase hex value.
 * Used for short, deterministic content fingerprints (batch receipts,
 * persistence checksums live next to their own implementation).
 */
export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
