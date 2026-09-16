import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/library");
  await page.evaluate(() => window.localStorage.clear());
});

test("prepares a portable offline handoff and releases scope on acceptance", async ({
  page,
}) => {
  await page.goto("/handoff");
  await page.getByRole("button", { name: "Start offline session" }).click();
  await expect(page.getByText("OFFLINE SESSION ACTIVE")).toBeVisible();

  // Fieldwork during the offline session: add a new clip through the library.
  await page.goto("/library");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-HANDOFF-01");
  await page.getByLabel("Title").fill("Night bridge overpass");
  await page.getByLabel("Recorder / source").fill("Off-grid crew");
  await page.getByLabel("Recording date").fill("2027-05-02");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("North bridge");
  await page
    .getByLabel("Clip summary")
    .fill(
      "A distant train layer recorded while the team worked without network access.",
    );
  await page.getByRole("button", { name: "Add clip" }).last().click();
  await expect(page.getByText("Night bridge overpass").first()).toBeVisible();

  // While no handoff packet exists yet, release judgment is blocked by the open session.
  await page.goto("/quality");
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(
    page.getByText(/offline handoff session is open/i),
  ).toBeVisible();

  // Prepare the handoff packet for the receiving colleague.
  await page.goto("/handoff");
  await page.getByRole("button", { name: "Prepare handoff" }).click();
  await page.getByLabel("Outgoing colleague").fill("Lin Qiao");
  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page
    .getByLabel("Session note")
    .fill("Recorded cold; levels held well.");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("What remains?").fill("Confirm bridge clip consent");
  await page
    .getByLabel("Detail")
    .fill("Speaker near the third pillar still needs a callback.");
  await page.getByRole("button", { name: "Prepare packet" }).click();

  await expect(
    page.getByRole("heading", { name: /Handoff #1 · Lin Qiao/ }),
  ).toBeVisible();
  await expect(
    page.getByText("New clip SC-HANDOFF-01 · Night bridge overpass"),
  ).toBeVisible();
  await expect(page.getByText("Confirm bridge clip consent")).toBeVisible();

  // The pending packet is carried in the app chrome and blocks release.
  await expect(page.getByText("Handoff pending").first()).toBeVisible();
  await page.goto("/quality");
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(
    page.getByText(/waiting for receiver confirmation/i),
  ).toBeVisible();

  // The portable checklist can be carried away on disk.
  await page.goto("/handoff");
  await expect(page.getByRole("button", { name: "Portable list" })).toBeVisible();

  // Receiver confirms: scope enters normal judgment and history keeps lineage.
  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page
    .getByRole("button", { name: /Confirm & accept scope/ })
    .click();
  await expect(page.getByText("Handoff accepted")).toBeVisible();
  await expect(page.getByText("Work introduced through a handoff")).toBeVisible();
  await expect(page.getByText("Lin Qiao").first()).toBeVisible();
});

test("declining a pending handoff rolls its new clip out of the study", async ({
  page,
}) => {
  await page.goto("/handoff");
  await page.getByRole("button", { name: "Start offline session" }).click();
  await page.goto("/library");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-HANDOFF-02");
  await page.getByLabel("Title").fill("Clip that will be returned");
  await page.getByLabel("Recorder / source").fill("Off-grid crew");
  await page.getByLabel("Recording date").fill("2027-05-03");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("East yard");
  await page
    .getByLabel("Clip summary")
    .fill("A take the receiver declines because the session scope is wrong.");
  await page.getByRole("button", { name: "Add clip" }).last().click();

  await page.goto("/handoff");
  await page.getByRole("button", { name: "Prepare handoff" }).click();
  await page.getByLabel("Outgoing colleague").fill("Lin Qiao");
  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page.getByRole("button", { name: "Prepare packet" }).click();
  await expect(
    page.getByText("New clip SC-HANDOFF-02 · Clip that will be returned"),
  ).toBeVisible();

  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page.getByRole("button", { name: "Decline handoff" }).click();
  await expect(page.getByText("rolled back")).toBeVisible();

  await page.goto("/library");
  await expect(
    page.getByText("Clip that will be returned"),
  ).toHaveCount(0);
});

test("locks the prepared checklist until the receiver confirms; withdrawing reopens editing", async ({
  page,
}) => {
  await page.goto("/handoff");
  await page.getByRole("button", { name: "Start offline session" }).click();
  await page.goto("/library");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-HANDOFF-03");
  await page.getByLabel("Title").fill("Clip listed in the packet");
  await page.getByLabel("Recorder / source").fill("Off-grid crew");
  await page.getByLabel("Recording date").fill("2027-05-04");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("West gate");
  await page
    .getByLabel("Clip summary")
    .fill("A take that is correctly part of the prepared checklist.");
  await page.getByRole("button", { name: "Add clip" }).last().click();

  await page.goto("/handoff");
  await page.getByRole("button", { name: "Prepare handoff" }).click();
  await page.getByLabel("Outgoing colleague").fill("Lin Qiao");
  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page.getByRole("button", { name: "Prepare packet" }).click();
  await expect(
    page.getByText("New clip SC-HANDOFF-03 · Clip listed in the packet"),
  ).toBeVisible();

  // Once prepared, the library cannot add or change any clip: the confirmed
  // checklist must not diverge from what the receiver actually takes over.
  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Add clip" })).toBeDisabled();
  const editButtons = await page
    .getByRole("button", { name: "Edit" })
    .all();
  for (const button of editButtons) await expect(button).toBeDisabled();

  // The outgoing worker withdraws to fold in one more change, then re-prepares.
  await page.goto("/handoff");
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: /Withdraw & keep editing/ })
    .click();
  await expect(page.getByText("Handoff withdrawn")).toBeVisible();
  await expect(page.getByText("OFFLINE SESSION ACTIVE")).toBeVisible();

  await page.goto("/library");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill("SC-HANDOFF-04");
  await page.getByLabel("Title").fill("Clip added after withdrawal");
  await page.getByLabel("Recorder / source").fill("Off-grid crew");
  await page.getByLabel("Recording date").fill("2027-05-05");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("West gate");
  await page
    .getByLabel("Clip summary")
    .fill("A late take that must appear on the freshly reconfirmed checklist.");
  await page.getByRole("button", { name: "Add clip" }).last().click();
  await expect(page.getByText("Clip added after withdrawal")).toBeVisible();

  await page.goto("/handoff");
  await page.getByRole("button", { name: "Prepare handoff" }).click();
  await page.getByLabel("Outgoing colleague").fill("Lin Qiao");
  await page.getByLabel("Receiving colleague").fill("Amina Patel");
  await page.getByRole("button", { name: "Prepare packet" }).click();

  // The new packet (#2) lists BOTH clips, so nothing is hidden from the receiver.
  await expect(
    page.getByRole("heading", { name: /Handoff #2 · Lin Qiao/ }),
  ).toBeVisible();
  await expect(
    page.getByText("New clip SC-HANDOFF-03 · Clip listed in the packet"),
  ).toBeVisible();
  await expect(
    page.getByText("New clip SC-HANDOFF-04 · Clip added after withdrawal"),
  ).toBeVisible();
  // The withdrawn first packet remains in history.
  await expect(page.getByText("withdrawn before confirmation")).toBeVisible();
});
