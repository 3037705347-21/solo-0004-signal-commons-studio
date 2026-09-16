import { expect, test } from "@playwright/test";

const recording = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    batchId: "e2e-batch-001",
    label: "Playwright sweep",
    recordings: [
      {
        catalogId: "SC-E2E-101",
        title: "Foggy overpass footsteps",
        source: "E2E field team",
        recordedOn: "2026-09-14",
        format: "WAV",
        location: "North overpass",
        summary:
          "Slow footsteps through fog with a distant bus braking at the junction.",
        sampleRate: 48000,
        channels: 2,
        bitDepth: 24,
        durationSeconds: 95,
        signalRole: "arrival",
        sensitivity: "public",
        transcriptStatus: "draft",
        consentStatus: "confirmed",
        tags: ["fog", "transit"],
      },
      {
        catalogId: "SC-E2E-102",
        title: "Canal gate rhythm",
        source: "E2E field team",
        recordedOn: "2026-09-14",
        format: "WAV",
        location: "Canal walk gate",
        summary:
          "A repeating gate latch and lapping water mark the turnaround point.",
        sampleRate: 48000,
        channels: 2,
        bitDepth: 24,
        durationSeconds: 88,
        signalRole: "departure",
        sensitivity: "public",
        transcriptStatus: "missing",
        consentStatus: "pending",
      },
      ...[],
    ],
    ...overrides,
  });

test.describe("field batch import", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library");
  });

  test("reviews a whole batch, fixes a flagged row, and receives it atomically", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import batch" }).click();
    const invalid = recording({
      recordings: [
        ...JSON.parse(recording({})).recordings.slice(0, 1),
        {
          catalogId: "SC-E2E-102",
          title: "Canal gate rhythm",
          source: "E2E field team",
          recordedOn: "2026-09-14",
          format: "WAV",
          location: "Canal walk gate",
          summary: "short",
          sampleRate: 48000,
          channels: 2,
          bitDepth: 24,
          durationSeconds: 88,
          signalRole: "departure",
          sensitivity: "public",
          transcriptStatus: "missing",
          consentStatus: "pending",
        },
      ],
    });
    await page.getByLabel("Batch JSON contents").fill(invalid);
    await page.getByRole("button", { name: "Review batch" }).click();

    // One flagged row blocks the whole batch; nothing is saved yet.
    await expect(page.getByText("1 need attention")).toBeVisible();
    const receiveButton = page.getByRole("button", { name: /Receive \d+ items?/ });
    await expect(receiveButton).toBeDisabled();
    await expect(
      page.getByText(/no partial data is saved/i),
    ).toBeVisible();
    await expect(page.getByText("Foggy overpass footsteps")).toHaveCount(0);

    // Fix the flagged row inline — summary is the last textarea in row 02.
    const cards = page.locator(".batch-row-card");
    await expect(cards).toHaveCount(2);
    const secondCard = cards.nth(1);
    await secondCard.getByLabel("Summary").fill("A repaired long enough summary of the canal gate sound.");

    await expect(page.getByText("2 ready")).toBeVisible();
    await page.getByRole("button", { name: /Receive 2 items?/ }).click();

    // Both clips land together, and the review modal closes.
    await expect(page.getByText("Foggy overpass footsteps")).toBeVisible();
    await expect(page.getByText("Canal gate rhythm")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Reload: the study persisted the batch but the in-progress draft is gone.
    await page.reload();
    await expect(page.getByText("Foggy overpass footsteps")).toBeVisible();
    await expect(page.getByText(/waiting for review/i)).toHaveCount(0);
  });

  test("resumes the batch at the review step after the app is reopened", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import batch" }).click();
    await page.getByLabel("Batch JSON contents").fill(recording({}));
    await page.getByRole("button", { name: "Review batch" }).click();
    await expect(page.getByText("2 ready")).toBeVisible();

    await page.reload();
    await expect(page.getByText(/A field batch is waiting for review/i)).toBeVisible();
    await page.getByRole("button", { name: "Continue batch" }).click();
    await expect(page.getByText(/Resumed your in-progress batch/i)).toBeVisible();
    // Review step renders rows as editable inputs with the restored values.
    const cards = page.locator(".batch-row-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByLabel("Title")).toHaveValue(
      "Foggy overpass footsteps",
    );
    await expect(cards.nth(1).getByLabel("Title")).toHaveValue("Canal gate rhythm");
    await expect(page.getByText("2 ready")).toBeVisible();

    await page.getByRole("button", { name: /Receive 2 items?/ }).click();
    // Once received the titles become library card headings.
    await expect(page.getByText("Foggy overpass footsteps")).toBeVisible();
    await expect(page.getByText("Canal gate rhythm")).toBeVisible();
  });

  test("does not duplicate recordings when the same batch is submitted twice", async ({
    page,
  }) => {
    async function submitOnce() {
      await page.getByRole("button", { name: "Import batch" }).click();
      await page.getByLabel("Batch JSON contents").fill(recording({}));
      await page.getByRole("button", { name: "Review batch" }).click();
      await page.getByRole("button", { name: /Receive 2 items?/ }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await submitOnce();
    await expect(page.getByText("Foggy overpass footsteps")).toHaveCount(1);

    // Re-paste the identical batch: every row is recognized as already received.
    await page.getByRole("button", { name: "Import batch" }).click();
    await page.getByLabel("Batch JSON contents").fill(recording({}));
    await page.getByRole("button", { name: "Review batch" }).click();
    await expect(page.getByText("2 duplicate")).toBeVisible();
    const receiveButton = page.getByRole("button", { name: /Receive 0 items?/ });
    await expect(receiveButton).toBeDisabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await expect(page.getByText("Foggy overpass footsteps")).toHaveCount(1);
    await expect(page.getByText("Canal gate rhythm")).toHaveCount(1);
  });

  test("blocks the whole batch when a section of the file is unreadable until the source is repaired", async ({
    page,
  }) => {
    const base = JSON.parse(recording({}));
    // Second record physically damaged in the source file: a null entry that
    // cannot become a row, next to one perfectly readable record.
    const damaged = JSON.stringify({
      ...base,
      batchId: "e2e-batch-damaged",
      recordings: [base.recordings[0], null],
    });

    await page.getByRole("button", { name: "Import batch" }).click();
    await page.getByLabel("Batch JSON contents").fill(damaged);
    await page.getByRole("button", { name: "Review batch" }).click();

    // The readable record is shown, but the file defect blocks receipt.
    await expect(page.getByText("1 unreadable in file")).toBeVisible();
    const fileErrorPanel = page.locator(".batch-file-errors");
    await expect(
      fileErrorPanel.getByText(/record could not be read/i),
    ).toBeVisible();
    await expect(fileErrorPanel.getByText("recordings[2]")).toBeVisible();
    const blockedButton = page.getByRole("button", {
      name: /Blocked · 1 unreadable section/,
    });
    await expect(blockedButton).toBeDisabled();
    // The readable row is present for context yet must not be saved.
    const cards = page.locator(".batch-row-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByLabel("Title")).toHaveValue(
      "Foggy overpass footsteps",
    );

    // Reload mid-review: the blocked shipment and its defect are still known.
    await page.reload();
    await page.getByRole("button", { name: "Continue batch" }).click();
    await expect(
      page.locator(".batch-file-errors").getByText(/record could not be read/i),
    ).toBeVisible();
    await expect(blockedButton).toBeDisabled();

    // Repair the source file and review again.
    await page.getByRole("button", { name: "Back to source to repair" }).click();
    const repaired = JSON.stringify({
      ...base,
      batchId: "e2e-batch-damaged",
      recordings: base.recordings,
    });
    await page.getByLabel("Batch JSON contents").fill(repaired);
    await page.getByRole("button", { name: "Review batch" }).click();
    await expect(page.getByText("2 ready")).toBeVisible();
    await page.getByRole("button", { name: /Receive 2 items?/ }).click();

    // Nothing entered the library before this point; both clips land together.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Foggy overpass footsteps")).toBeVisible();
    await expect(page.getByText("Canal gate rhythm")).toBeVisible();
  });
});
