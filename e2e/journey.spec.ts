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

test("blocks a placement that exceeds the target site capacity", async ({
  page,
}) => {
  await page.goto("/route");
  const voices = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Shared voices" }) });
  await page.getByRole("button", { name: /Storm drain resonance/i }).click();
  await voices
    .getByRole("button", { name: /Place Storm drain resonance here/i })
    .click();
  await page.getByRole("button", { name: /Park fence harmonics/i }).click();
  await voices
    .getByRole("button", { name: /Place Park fence harmonics here/i })
    .click();

  await expect(page.getByText(/supports up to 2 clips/)).toBeVisible();
});
