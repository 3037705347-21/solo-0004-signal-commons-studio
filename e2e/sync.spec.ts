import { expect, test } from "@playwright/test";

test("synchronizes committed workspace changes across browser tabs", async ({
  context,
  page,
}) => {
  const secondPage = await context.newPage();
  await Promise.all([page.goto("/library"), secondPage.goto("/library")]);

  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-SYNC-001");
  await page.getByLabel("Title").fill("Cross-tab signal");
  await page.getByLabel("Recorder / source").fill("Field sync team");
  await page.getByLabel("Recording date").fill("2027-04-01");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Shared listening room");
  await page
    .getByLabel("Clip summary")
    .fill(
      "A synchronized field signal used to verify refresh propagation across tabs.",
    );
  await page.getByRole("button", { name: "Add clip" }).last().click();

  await expect(secondPage.getByText("Cross-tab signal")).toBeVisible();
});
