import { test, expect } from "@playwright/test";

test.describe("rule versioning", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rules");
  });

  test("shows the active baseline rule version and lineage", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Field season 2026 baseline/ }),
    ).toBeVisible();
    await expect(page.getByText(/In force/)).toBeVisible();
    await expect(page.getByText("Warn at 80% of site target")).toBeVisible();
  });

  test("previews impact and keeps evaluation unchanged until a draft is adopted", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Propose adjustment" }).click();
    await expect(
      page.getByRole("heading", { name: "Adjust the study rule basis" }),
    ).toBeVisible();

    // Tightening the capacity warning threshold should surface affected sites.
    await page.getByLabel("Warn at").fill("30");
    await expect(page.getByText("IMPACT PREVIEW")).toBeVisible();
    await expect(page.getByText(/Sites affected/)).toBeVisible();

    // Saving the draft closes nothing about evaluation: active rule card
    // still shows the baseline at 80%.
    await page.getByLabel("Version name").fill("Winter pilot thresholds");
    await page
      .getByLabel("Reason for change")
      .fill("Sites fill more quickly during winter pilot walks.");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText(/awaiting confirmation/)).toBeVisible();
    await expect(page.getByText("Warn at 80% of site target")).toBeVisible();

    // The side nav flags the pending draft.
    await expect(
      page.locator(".nav-pending-dot"),
    ).toBeVisible();
  });

  test("adopts a confirmed draft as the new active version", async ({ page }) => {
    await page.getByRole("button", { name: "Propose adjustment" }).click();
    await page.getByLabel("Warn at").fill("30");
    await page.getByLabel("Version name").fill("Winter pilot thresholds");
    await page
      .getByLabel("Reason for change")
      .fill("Sites fill more quickly during winter pilot walks.");
    await page.getByRole("button", { name: "Adopt now" }).click();

    await expect(
      page.getByRole("heading", { name: "Winter pilot thresholds" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Warn at 30% of site target")).toBeVisible();
    await expect(page.getByText(/awaiting confirmation/)).toHaveCount(0);

    // Both versions remain in the lineage.
    const rows = page.locator(".rule-version-row");
    await expect(rows).toHaveCount(2);
  });

  test("discarding a draft leaves the active basis untouched", async ({ page }) => {
    await page.getByRole("button", { name: "Propose adjustment" }).click();
    await page.getByLabel("Warn at").fill("45");
    await page.getByLabel("Version name").fill("Abandoned experiment");
    await page
      .getByLabel("Reason for change")
      .fill("An experiment with tighter headroom that we decide against.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Discard" }).click();

    await expect(page.getByText(/awaiting confirmation/)).toHaveCount(0);
    await expect(page.getByText("Warn at 80% of site target")).toBeVisible();
    await expect(page.locator(".rule-version-row")).toHaveCount(1);
  });
});
