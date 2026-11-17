import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "../src/features/settings/SettingsSelect";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSelect(value = "0", onChange = vi.fn()) {
  render(<>
    <SettingsSelect compact label="Equalizer" value={value} onChange={onChange}>
      {Array.from({ length: 10 }, (_, i) => <option key={i} value={String(i)}>Preset {i}</option>)}
    </SettingsSelect>
    <button type="button">Outside</button>
  </>);
  return { trigger: screen.getByRole("combobox"), onChange };
}

describe("SettingsSelect dismissal", () => {
  it("scrolls a selected preset inside the list without scrolling the page", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "option"
        ? Array.from(this.parentElement!.children).indexOf(this) * 30 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(90);
    // Model the browser scrolling an ancestor to reveal an off-screen option.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrollPage = vi.fn(() => fireEvent.scroll(document));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollPage });
    try {
      const { trigger } = renderSelect("9");
      fireEvent.click(trigger);
      const list = screen.getByRole("listbox");
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(list.scrollTop).toBe(210);
      expect(scrollPage).not.toHaveBeenCalled();
      fireEvent.scroll(list);
      fireEvent.pointerMove(screen.getByRole("option", { name: "Preset 8" }));
      expect(screen.getByRole("listbox")).toBe(list);
      fireEvent.scroll(document);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("keeps the list through a transient blur and lets the preset click complete", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderSelect();
    await user.click(trigger);
    // The scrollbar/window can blur the trigger without focusing another control.
    fireEvent.blur(trigger, { relatedTarget: null });
    const option = screen.getByRole("option", { name: "Preset 4" });
    await user.click(option);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("4");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when focus moves to another control or the user clicks outside", async () => {
    const user = userEvent.setup();
    const { trigger } = renderSelect();
    await user.click(trigger);
    fireEvent.focusIn(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps keyboard selection and lets Escape close only the nested menu", async () => {
    const user = userEvent.setup();
    const parentEscape = vi.fn();
    window.addEventListener("keydown", parentEscape);
    try {
      const { trigger, onChange } = renderSelect();
      await user.click(trigger);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenCalledExactlyOnceWith("1");
      await user.click(trigger);
      parentEscape.mockClear();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(parentEscape).not.toHaveBeenCalled();
      await user.click(trigger);
      await user.tab();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    } finally {
      window.removeEventListener("keydown", parentEscape);
    }
  });
});
