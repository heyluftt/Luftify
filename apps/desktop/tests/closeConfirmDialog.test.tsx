import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseConfirmDialog } from "../src/components/CloseConfirmDialog";

describe("close confirmation", () => {
  afterEach(() => cleanup());

  it("passes the choice and whether to stop asking", () => {
    const onAnswer = vi.fn();
    render(<CloseConfirmDialog onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Nicht mehr fragen" }));
    fireEvent.click(screen.getByRole("button", { name: "Beenden" }));
    expect(onAnswer).toHaveBeenLastCalledWith("exit", true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAnswer).toHaveBeenLastCalledWith("cancel", false);
  });
});
