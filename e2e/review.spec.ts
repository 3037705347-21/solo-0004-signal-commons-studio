import { test, expect } from "@playwright/test";

test("advance a quality finding and run readiness check", async ({ page }) => {
  await page.goto("/quality");
  await page.getByRole("button", { name: "Start work" }).first().click();
  await expect(page.getByText("In Progress").first()).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).first().click();
  await expect(page.getByText("Resolved").first()).toBeVisible();
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(
    page.getByText(/Still needs attention|Ready to share/),
  ).toBeVisible();
});
