import { test, expect } from "@playwright/test";

test("place a recording into a listening site", async ({ page }) => {
  await page.goto("/route");
  const queueItem = page.getByRole("button", { name: /Park fence harmonics/i });
  await queueItem.click();
  await page
    .getByRole("button", { name: /Place Park fence harmonics here/i })
    .first()
    .click();
  await expect(page.getByText("Park fence harmonics").first()).toBeVisible();
});
