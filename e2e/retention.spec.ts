import { test, expect } from "@playwright/test";

test("retain findings and links after a site is cleaned", async ({ page }) => {
  await page.goto("/quality");

  // The retirement finding cites a site and clip that were cleaned in the
  // long-running study seed.
  const retirement = page.getByText("Harbor loop retirement");
  await expect(retirement).toBeVisible();
  await expect(page.getByText("Site cleaned").first()).toBeVisible();
  await expect(page.getByText("Clip cleaned").first()).toBeVisible();

  // The cleaned site is reachable through the site filter optgroup.
  const siteSelect = page.getByRole("combobox", { name: "Listening site" });
  await siteSelect.selectOption("site-old-harbor");
  await expect(
    page.getByText(
      "Showing retained findings for a site that has been cleaned.",
    ),
  ).toBeVisible();
  await expect(retirement).toBeVisible();
  // No field checklist is offered for a cleaned site.
  await expect(
    page.getByRole("button", { name: "Download site checklist (CSV)" }),
  ).toHaveCount(0);
});

test("archive and restore a clip, then require a fresh readiness check", async ({
  page,
}) => {
  await page.goto("/retention");

  // The expired, unplaced autumn intake clip is eligible for archival.
  await page.getByRole("button", { name: "Archive" }).first().waitFor();
  const expiredRow = page.getByText("Old belltower ambience").first();
  const row = expiredRow.locator("xpath=ancestor::div[contains(@class,'retention-row')]");
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Clip archived")).toBeVisible();

  // After archival the clip can be restored from the Archived view.
  await page.getByRole("button", { name: "Archived", exact: false }).first().click();
  await page.getByText("Old belltower ambience").waitFor();
  const archivedRow = page
    .getByText("Old belltower ambience")
    .first()
    .locator("xpath=ancestor::div[contains(@class,'retention-row')]");
  await archivedRow.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText(/must pass a fresh readiness check/),
  ).toBeVisible();

  // The restored clip forces release re-qualification in the quality gate.
  await page.goto("/quality");
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(page.getByText(/restored clip/i)).toBeVisible();
});

test("the retention sweep archives due material without deleting protected references", async ({
  page,
}) => {
  await page.goto("/retention");
  await page.getByRole("button", { name: "Run retention sweep" }).click();
  await expect(
    page.getByText(/Retention sweep archived|Nothing is due/),
  ).toBeVisible();

  // The historical release version and its cleaned-clip citation remain in
  // the lineage section and resolve (no dangling ids).
  await expect(page.getByText("Release #1")).toBeVisible();
  await expect(page.getByText(/embeds 1 clip/)).toBeVisible();
});
