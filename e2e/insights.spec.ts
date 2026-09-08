import { test, expect } from "@playwright/test";

test("compare and apply a listener scenario", async ({ page }) => {
  await page.goto("/scenarios");
  await page.getByRole("button", { name: "Brief" }).click();
  await page.locator("#group-size").evaluate((slider, value) => {
    const input = slider as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, 12);
  await expect(page.getByText("Brief listening")).toBeVisible();
  await page.getByRole("button", { name: "Apply preferences" }).click();
  await expect(page.getByText("Planning preferences applied.")).toBeVisible();
});
