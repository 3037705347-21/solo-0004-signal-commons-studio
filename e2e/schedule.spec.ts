import { expect, test } from "@playwright/test";

async function resetSampleStudy(page: import("@playwright/test").Page) {
  await page.goto("/schedule");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByLabel("Weekend start date")).toHaveValue("2026-09-19");
}

test("shows uncovered sites, unavailable colleagues, and overlapping shifts", async ({
  page,
}) => {
  await resetSampleStudy(page);

  // Saturday: Daily rhythms has nobody assigned.
  await expect(
    page.getByText(/Daily rhythms has no available colleague on/),
  ).toBeVisible();

  // Milo is double-booked Saturday afternoon.
  await expect(
    page.getByText(
      /Milo Chen is expected at Return and release and Threshold listening/,
    ),
  ).toBeVisible();

  // Sunday Voices keeps its date column: Rosa is unavailable that day,
  // leaving the site uncovered instead of disappearing.
  await expect(
    page.getByText(/Shared voices has no available colleague on/),
  ).toBeVisible();
  await expect(page.getByText(/Rosa Mendes is unavailable on/)).toBeVisible();
});

test("adding a shift closes a coverage gap and removing it reopens the gap", async ({
  page,
}) => {
  await resetSampleStudy(page);

  await page
    .getByRole("button", {
      name: /Add a shift at Daily rhythms on Sat/,
    })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Listening site")).toHaveValue("site-rhythm");
  await dialog.getByLabel("Colleague").selectOption("member-lin");
  await dialog.getByLabel("Visit day").selectOption("2026-09-19");
  await dialog.getByLabel("Start time").fill("13:00");
  await dialog.getByLabel("End time").fill("14:00");
  await page.getByRole("button", { name: "Add to plan" }).click();

  await expect(
    page.getByText(/Daily rhythms has no available colleague on/),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /Remove shift at Rhythms/ })
    .first()
    .click();
  await expect(
    page.getByText(/Daily rhythms has no available colleague on/),
  ).toBeVisible();
});

test("schedule changes survive reload", async ({ page }) => {
  await resetSampleStudy(page);

  await page
    .getByRole("button", {
      name: /Add a shift at Daily rhythms on Sat/,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Colleague").selectOption("member-amina");
  await dialog.getByLabel("Visit day").selectOption("2026-09-19");
  await dialog.getByLabel("Start time").fill("08:00");
  await dialog.getByLabel("End time").fill("09:00");
  await page.getByRole("button", { name: "Add to plan" }).click();

  await page.reload();
  await expect(
    page.getByRole("button", { name: /Edit shift at Rhythms/ }).first(),
  ).toBeVisible();
  // Amina's early shift survived with the rest of the weekend plan.
  await expect(
    page.getByRole("button", { name: /Amina Patel[\s\S]*08:00–09:00/ }),
  ).toHaveCount(1);
});
