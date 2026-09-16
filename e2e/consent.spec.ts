import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Clear once on the initial load. addInitScript would otherwise re-run on
  // every in-test navigation (goto) and wipe the committed workspace.
  await page.goto("/library");
  await page.evaluate(() => window.localStorage.clear());
});

test("withdrawn consent immediately blocks the placed clip and pending release", async ({
  page,
}) => {
  await page.goto("/consent");
  const card = page.getByTestId("consent-card-rec-underpass");
  await expect(card).toContainText(/Confirmed/);

  // The route already carries the expired courtyard finding, but the underpass
  // clip is still clear before withdrawal.
  await page.goto("/route");
  await expect(
    page.getByText(/Underpass reverb at dawn: Consent was withdrawn/),
  ).toHaveCount(0);

  // Withdraw consent from the ledger.
  await page.goto("/consent");
  await card.getByRole("button", { name: "Withdraw" }).click();
  await page.getByLabel("Granted / withdrawn by").fill("Lin Qiao");
  await page.getByLabel("Channel").fill("Verbal withdrawal with witness");
  await page.getByLabel("Evidence reference").fill("NOTE-WITHDRAW-001");
  await page.getByRole("button", { name: "Confirm withdrawal" }).click();

  await expect(card).toContainText(/Withdrawn/);
  await expect(card).toContainText(/Threshold/);

  // Route board immediately shows the blocking finding on the placed clip.
  await page.goto("/route");
  await expect(
    page.getByText(/Underpass reverb at dawn: Consent was withdrawn/),
  ).toBeVisible();

  // The readiness check counts both the expired courtyard and the withdrawn
  // underpass as placed clips without usable consent, and cannot release.
  await page.goto("/quality");
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(page.getByText(/2 placed clips lack usable route consent/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export snapshot" })).toHaveCount(
    0,
  );
});

test("narrowing consent scope flags the archive gap without blocking the route", async ({
  page,
}) => {
  await page.goto("/consent");
  const card = page.getByTestId("consent-card-rec-tram");

  await card.getByRole("button", { name: "Narrow scope" }).click();
  const dialog = page.getByRole("dialog");
  // Untick transcript and archive, leaving route-only consent.
  await dialog.getByText("Transcript & captions").click();
  await dialog.getByText("Public archive").click();
  await page.getByLabel("Granted / withdrawn by").fill("Rosa Mendes");
  await page.getByLabel("Channel").fill("Follow-up text message");
  await page.getByLabel("Evidence reference").fill("SMS-2026-090");
  await page.getByRole("button", { name: "Save restricted scope" }).click();

  await expect(card).toContainText(/Restricted scope/);
  await expect(card).toContainText(/Route cleared, archive not released/);
  expect(
    await page.getByTestId("purpose-rec-tram-archive").getAttribute("class"),
  ).toContain("uncovered");

  // Route placement of the tram remains valid.
  await page.goto("/route");
  await expect(
    page.getByText(/Tram brake chorus:.*(withdrawn|expired|scope)/),
  ).toHaveCount(0);

  // The ledger summary surfaces the new archive gap.
  await page.goto("/consent");
  await expect(page.getByText(/ARCHIVE GAPS/)).toBeVisible();
});

test("renewing expired consent clears the blocking state", async ({ page }) => {
  await page.goto("/consent");
  await page.getByTestId("consent-filter-expired").click();
  const card = page.getByTestId("consent-card-rec-courtyard");
  await expect(card).toContainText(/Expired/);

  await card.getByRole("button", { name: "Record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Public archive").click();
  await page
    .getByLabel("Granted / withdrawn by")
    .fill("North Block listening circle");
  await page.getByLabel("Channel").fill("Group meeting minutes");
  await page.getByLabel("Evidence reference").fill("MINUTES-2026-015");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record consent" })
    .click();

  // Renewal moves the card out of the expired filter.
  await page.getByTestId("consent-filter-all").click();
  const renewedCard = page.getByTestId(
    "consent-card-rec-courtyard",
  );
  await expect(renewedCard).toContainText(/Confirmed/);
  await expect(renewedCard).not.toContainText(/Expired/);

  // The expired-consent route blocker disappears after renewal.
  await page.goto("/route");
  await expect(
    page.getByText(/Courtyard conversation: Consent has expired/),
  ).toHaveCount(0);
});
