import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-tab conflicts only fire when a tab commits without having received the
 * other tab's storage event (the real race window). Hold the workspace and
 * conflict-list storage events on a page until the test releases it, simulating
 * that delayed delivery.
 */
async function holdWorkspaceStorageEvents(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(() => {
    (window as unknown as { __holdStorage: boolean }).__holdStorage = true;
    window.addEventListener(
      "storage",
      (event: StorageEvent) => {
        if (
          (event.key === "signal-commons.workspace.v1" ||
            event.key === "signal-commons.conflicts.v1") &&
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

    // A resolved conflict must not come back: neither the freshly reloaded
    // resolving tab nor the other tab should show the pending entry again.
    await secondPage.reload();
    await expect(
      secondPage.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByRole("heading", { name: "My late edit" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("heading", { name: "Committed by teammate" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
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

    // The parked draft remains available, but the resolved conflict stays gone
    // after reloading either tab.
    await expect(
      secondPage.getByRole("button", { name: /Open saved conflict drafts/ }),
    ).toBeVisible();
    await secondPage.reload();
    await expect(
      secondPage.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByRole("button", { name: /Open saved conflict drafts/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
  });

  test("resolving the same conflict from both tabs does not reopen it after refresh", async ({
    context,
    page,
  }) => {
    const secondPage = await context.newPage();
    // Hold events on the late tab for the whole race so its dialog stays open
    // even after the first tab resolves the same shared conflict.
    const releaseSecondPage = await holdWorkspaceStorageEvents(secondPage);

    await Promise.all([
      page.goto("/library"),
      secondPage.goto("/library"),
    ]);

    // First tab commits; the late (held) tab diverges and records the conflict.
    await addClip(page, "SC-CONFLICT-E", "Teammate version");
    await addClip(secondPage, "SC-CONFLICT-F", "Late version");
    await expect(
      secondPage.getByRole("dialog", { name: "Two tabs changed this study" }),
    ).toBeVisible();

    // The shared conflict record surfaces on the first tab through storage.
    const firstTabAlert = page.getByRole("button", {
      name: /editing conflict/,
    });
    await expect(firstTabAlert).toBeVisible();
    await firstTabAlert.click();
    await expect(
      page.getByRole("dialog", { name: "Two tabs changed this study" }),
    ).toBeVisible();

    // Both tabs resolve the same conflict before either sees the other's
    // resolution commit.
    await page
      .getByRole("button", { name: "Keep committed version" })
      .click();
    await expect(
      secondPage.getByRole("button", { name: "Keep committed version" }),
    ).toBeVisible();
    await secondPage
      .getByRole("button", { name: "Keep committed version" })
      .click();

    // The second (stale) resolution must adopt the committed result, not open a
    // fresh conflict.
    await expect(
      secondPage.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByRole("heading", { name: "Teammate version" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("heading", { name: "Late version" }),
    ).toHaveCount(0);

    // Releasing queued events and reloading either tab keeps it resolved.
    await releaseSecondPage();
    await expect(
      page.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await secondPage.reload();
    await expect(
      secondPage.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByRole("heading", { name: "Teammate version" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("button", { name: /editing conflict/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Teammate version" }),
    ).toBeVisible();
  });
});
