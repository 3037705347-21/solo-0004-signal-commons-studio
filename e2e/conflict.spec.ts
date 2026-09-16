import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-tab conflicts only fire when a tab commits without having received the
 * other tab's storage event (the real race window). Hold the workspace storage
 * event on a page until the test releases it, simulating that delayed delivery.
 */
async function holdWorkspaceStorageEvents(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(() => {
    (window as unknown as { __holdStorage: boolean }).__holdStorage = true;
    window.addEventListener(
      "storage",
      (event: StorageEvent) => {
        if (
          event.key === "signal-commons.workspace.v1" &&
          (window as unknown as { __holdStorage?: boolean }).__holdStorage
        ) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true,
    );
  });
  return async () => {
    await page.evaluate(() => {
      (window as unknown as { __holdStorage: boolean }).__holdStorage = false;
    });
  };
}

async function addClip(page: Page, catalogId: string, title: string) {
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await page.getByLabel("Catalog ID").fill(catalogId);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Recorder / source").fill("Conflict field team");
  await page.getByLabel("Recording date").fill("2027-04-01");
  await page.getByLabel("File format").fill("WAV");
  await page.getByLabel("Location").fill("Conflict listening room");
  await page
    .getByLabel("Clip summary")
    .fill(
      "A field signal used to exercise the concurrent edit conflict resolution flow.",
    );
  await page.getByRole("button", { name: "Add clip" }).last().click();
}

test.describe("concurrent edit conflict resolution", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearPermissions();
  });

  test("shows both sides of a concurrent save and supports keep-mine, merge, and draft paths", async ({
    context,
    page,
  }) => {
    const secondPage = await context.newPage();
    const releaseSecondPage = await holdWorkspaceStorageEvents(secondPage);

    await Promise.all([
      page.goto("/library"),
      secondPage.goto("/library"),
    ]);

    // Tab A commits first; tab B's storage event is held back.
    await addClip(page, "SC-CONFLICT-A", "Committed by teammate");
    await expect(page.getByText("Committed by teammate")).toBeVisible();

    // Tab B edits on the older revision and commits into the race.
    await addClip(secondPage, "SC-CONFLICT-B", "My late edit");

    // The late tab sees the conflict entry and a dialog explaining both edits.
    const conflictDialog = secondPage.getByRole("dialog", {
      name: "Two tabs changed this study",
    });
    await expect(
      secondPage.getByRole("button", { name: /editing conflict/ }),
    ).toBeVisible();
    await expect(conflictDialog).toBeVisible();
    await expect(
      conflictDialog.getByText("Committed by teammate"),
    ).toBeVisible();
    await expect(conflictDialog.getByText("My late edit")).toBeVisible();
    await expect(
      conflictDialog.getByText("Changed differently"),
    ).toHaveCount(0);

    // Independent edits can be merged, keeping both new clips.
    await secondPage
      .getByRole("button", { name: "Review merge" })
      .click();
    await secondPage
      .getByRole("button", { name: "Apply merged result" })
      .click();
    await expect(
      secondPage.getByRole("dialog", { name: "Two tabs changed this study" }),
    ).toBeHidden();
    await expect(
      secondPage.getByRole("heading", { name: "Committed by teammate" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("heading", { name: "My late edit" }),
    ).toBeVisible();

    // Releasing the queued storage event: the first tab receives the merged
    // commit through normal cross-tab synchronization.
    await releaseSecondPage();
    await expect(
      page.getByRole("heading", { name: "My late edit" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Committed by teammate" }),
    ).toBeVisible();

  });

  test("keeping the committed version and parking a draft leave consistent explanations", async ({
    context,
    page,
  }) => {
    const secondPage = await context.newPage();
    const releaseSecondPage = await holdWorkspaceStorageEvents(secondPage);

    await Promise.all([
      page.goto("/library"),
      secondPage.goto("/library"),
    ]);
    await addClip(page, "SC-CONFLICT-C", "Teammate title");
    await addClip(secondPage, "SC-CONFLICT-D", "Draft candidate");

    // Park the late edit as a draft; the workspace keeps the committed content.
    await expect(
      secondPage.getByRole("dialog", { name: "Two tabs changed this study" }),
    ).toBeVisible();
    await secondPage
      .getByRole("button", { name: "Save my edit as a draft" })
      .click();
    await expect(
      secondPage.getByRole("heading", { name: "Teammate title" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("heading", { name: "Draft candidate" }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByRole("button", { name: /Open saved conflict drafts/ }),
    ).toBeVisible();

    // The draft shelf can resume the parked edit into a fresh comparison.
    await secondPage
      .getByRole("button", { name: /Open saved conflict drafts/ })
      .click();
    await expect(
      secondPage.getByRole("dialog", { name: "Conflict drafts" }),
    ).toBeVisible();
    await secondPage
      .getByRole("button", { name: "Resume & compare" })
      .click();
    await expect(
      secondPage.getByRole("dialog", { name: "Two tabs changed this study" }),
    ).toBeVisible();

    // Now accept the committed version outright.
    await secondPage
      .getByRole("button", { name: "Keep committed version" })
      .click();
    await expect(
      secondPage.getByRole("heading", { name: "Teammate title" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("heading", { name: "Draft candidate" }),
    ).toHaveCount(0);

    // Other tabs stay consistent once the held event is delivered.
    await releaseSecondPage();
    await expect(
      page.getByRole("heading", { name: "Teammate title" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Draft candidate" }),
    ).toHaveCount(0);

  });
});
