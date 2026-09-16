import { describe, expect, it } from "vitest";
import { createSeedStudy } from "./seed";
import {
  fnv1a,
  readEnvelopePayload,
  STORAGE_ENVELOPE_VERSION,
  writeWorkspaceEnvelope,
  type StorageEnvelope,
} from "./storageEnvelope";

describe("storage envelope codec", () => {
  it("round trips a workspace state through the checksummed envelope", () => {
    const state = createSeedStudy();
    const raw = writeWorkspaceEnvelope(state);
    const envelope = JSON.parse(raw) as StorageEnvelope;

    expect(envelope.storageVersion).toBe(STORAGE_ENVELOPE_VERSION);
    expect(envelope.checksum).toBe(fnv1a(envelope.stateJson));
    expect(readEnvelopePayload(raw)).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("rejects an envelope whose payload was tampered with", () => {
    const envelope = JSON.parse(
      writeWorkspaceEnvelope(createSeedStudy()),
    ) as StorageEnvelope;
    const tamperedPayload = JSON.stringify({
      ...envelope,
      stateJson: envelope.stateJson.replace("Signal Commons", "Forged Commons"),
    });
    expect(readEnvelopePayload(tamperedPayload)).toBeNull();

    const tamperedChecksum = JSON.stringify({ ...envelope, checksum: "deadbeef" });
    expect(readEnvelopePayload(tamperedChecksum)).toBeNull();
  });

  it("passes legacy unenveloped records through for migration", () => {
    const legacy = { ...createSeedStudy(), version: 1 };
    const payload = readEnvelopePayload(JSON.stringify(legacy));
    expect(payload).toMatchObject({ version: 1 });
  });

  it("returns null for missing or corrupt records", () => {
    expect(readEnvelopePayload(null)).toBeNull();
    expect(readEnvelopePayload("")).toBeNull();
    expect(readEnvelopePayload("{broken json")).toBeNull();
    expect(readEnvelopePayload(JSON.stringify({ storageVersion: 1 }))).toBeNull();
  });
});
