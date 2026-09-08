import { expect, test } from "@playwright/test";

test("filter by listening site and download the field checklist", async ({
  page,
}) => {
  await page.goto("/quality");

  await expect(
    page.getByRole("button", { name: "Download site checklist (CSV)" }),
  ).toHaveCount(0);
  const siteSelect = page.getByRole("combobox", { name: "Listening site" });
  await siteSelect.selectOption("site-voices");

  const card = page.getByRole("region", { name: "Listening site checklist" });
  await expect(
    card.getByRole("heading", { name: "Shared voices" }),
  ).toBeVisible();
  await expect(card.getByText("Courtyard conversation")).toBeVisible();
  await expect(card.getByText("241 sec")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await card
    .getByRole("button", { name: "Download site checklist (CSV)" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /signal-commons-route-checklist-voices-.*\.csv/,
  );

  await page.reload();
  await expect(siteSelect).toHaveValue("site-voices");
  await expect(
    card.getByRole("heading", { name: "Shared voices" }),
  ).toBeVisible();

  await siteSelect.selectOption("");
  await expect(
    page.getByRole("button", { name: "Download site checklist (CSV)" }),
  ).toHaveCount(0);
});
