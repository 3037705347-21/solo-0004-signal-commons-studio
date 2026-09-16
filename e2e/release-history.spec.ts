import { test, expect, type Page } from "@playwright/test";

async function resetWorkspace(page: Page) {
  await page.goto("/library");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Reset sample study/ }).click();
  await expect(page.getByText("Underpass reverb at dawn").first()).toBeVisible();
}

test("traces release versions, compares their impact, and forks a review draft", async ({
  page,
}) => {
  await resetWorkspace(page);
  await page.goto("/quality");

  // First check: the seed study is blocked by a critical consent finding.
  await page.getByRole("button", { name: "Run readiness check" }).click();
  await expect(page.getByText("Still needs attention")).toBeVisible();

  // Resolve the warning finding (already in progress), then check again: the
  // second version supersedes the first.
  const transcriptRow = page
    .getByRole("article")
    .filter({ hasText: "Add transcript for storm drain clip" });
  await transcriptRow.getByRole("button", { name: "Resolve" }).click();
  await expect(transcriptRow.getByText("Resolved").first()).toBeVisible();
  await page.getByRole("button", { name: /Re-check plan|Run readiness check/ }).first().click();

  await page.getByRole("button", { name: /Release history/ }).click();

  // Both checks remain traceable, newest first.
  const historyPanel = page.getByRole("dialog", { name: "Release history" });
  await expect(historyPanel).toBeVisible();
  await expect(historyPanel.getByText("v2").first()).toBeVisible();
  await expect(historyPanel.getByText("v1").first()).toBeVisible();

  // The newest version (v2) opens by default and its baseline is the version
  // it superseded (v1), so the v1 -> v2 impact is shown immediately.
  await expect(historyPanel.getByText(/Supersedes\s+v1/).first()).toBeVisible();
  await expect(historyPanel.getByText(/Quality findings/)).toBeVisible();
  await expect(
    historyPanel
      .locator(".impact-row")
      .filter({ hasText: "Add transcript for storm drain clip" })
      .getByText(/resolved/i),
  ).toBeVisible();

  // Selecting v1 shows it cannot replace anything: it was followed by v2.
  await historyPanel
    .locator(".release-version-row").filter({ hasText: /^v1/ })
    .click();
  await expect(historyPanel.getByText(/followed by v2/).first()).toBeVisible();

  // Fork v1 back into a fresh review draft.
  await historyPanel
    .getByRole("button", { name: "Start draft from this version" })
    .click();
  await expect(
    page.getByText(/new review draft was seeded from v1/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  // The workspace banner explains the draft state...
  await expect(
    page.getByText(/Review draft seeded from v1/),
  ).toBeVisible();
  // ...and the previously recorded check is no longer mistaken as publishable.
  await expect(page.getByText("Still needs attention")).toBeVisible();
  expect(await page.getByRole("button", { name: "Export snapshot" }).count()).toBe(0);

  // The forked finding is back at its v1 state (in progress), not resolved.
  const reopenedRow = page
    .getByRole("article")
    .filter({ hasText: "Add transcript for storm drain clip" });
  await expect(reopenedRow.getByText("Resolved")).toHaveCount(0);
  await expect(reopenedRow.getByRole("button", { name: "Resolve" })).toBeVisible();

  // History is untouched: the forked v1 still shows as superseded, not current.
  await page.getByRole("button", { name: /Release history/ }).click();
  await historyPanel
    .locator(".release-version-row").filter({ hasText: /^v1/ })
    .click();
  await expect(historyPanel.getByText(/followed by v2/).first()).toBeVisible();
});
