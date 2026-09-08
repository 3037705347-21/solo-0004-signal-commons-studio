import { test, expect } from "@playwright/test";

test("curate a recording through the library route", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-2027-901");
  await page.getByLabel("Title").fill("Rain Crossing Harmonics");
  await page.getByLabel("Recorder / source").fill("Studio North");
  await page.getByLabel("Recording date").fill("2027-03-12");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Maple Street crossing");
  await page
    .getByLabel("Clip summary")
    .fill(
      "Rain, tires, and a crossing signal create a changing arrival texture for the route.",
    );
  await page.getByRole("button", { name: "Add clip" }).last().click();
  await expect(page.getByText("Rain Crossing Harmonics")).toBeVisible();
});
