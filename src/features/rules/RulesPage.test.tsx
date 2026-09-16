import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudyProvider } from "../../state/StudyContext";
import { RulesPage } from "./RulesPage";

afterEach(() => cleanup());

function renderPage() {
  return render(
    <StudyProvider>
      <RulesPage />
    </StudyProvider>,
  );
}

describe("RulesPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the active baseline version and its thresholds", () => {
    renderPage();
    const card = screen.getByLabelText("Active rule version");
    expect(
      within(card).getByRole("heading", {
        name: /Field season 2026 baseline/,
      }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Warn at 80% of site target"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Block at 100% of site target"),
    ).toBeInTheDocument();
  });

  it("holds a saved draft aside without changing the active basis", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Propose adjustment" }),
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Warn at"), {
      target: { value: "30" },
    });
    fireEvent.change(within(dialog).getByLabelText("Version name"), {
      target: { value: "Winter pilot thresholds" },
    });
    fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
      target: {
        value: "Sites fill more quickly during winter pilot walks.",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));

    expect(
      screen.getByText(/awaiting confirmation/),
    ).toBeInTheDocument();
    // The active basis is still the 80% baseline.
    expect(screen.getByText("Warn at 80% of site target")).toBeInTheDocument();
  });

  it("adopts the confirmed draft as the new active version", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Propose adjustment" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Warn at"), {
      target: { value: "30" },
    });
    fireEvent.change(within(dialog).getByLabelText("Version name"), {
      target: { value: "Winter pilot thresholds" },
    });
    fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
      target: {
        value: "Sites fill more quickly during winter pilot walks.",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adopt now" }));

    const card = screen.getByLabelText("Active rule version");
    expect(
      within(card).getByRole("heading", { name: "Winter pilot thresholds" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Warn at 30% of site target"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/awaiting confirmation/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".rule-version-row")).toHaveLength(2);
  });
});
