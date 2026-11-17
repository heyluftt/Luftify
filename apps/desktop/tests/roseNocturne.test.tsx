import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoseNocturne } from "../src/features/theme/RoseNocturne";

describe("RoseNocturne", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it("stays unmounted outside Rosé Nocturne", () => {
    document.documentElement.dataset.theme = "luft.dark";
    const { container } = render(<RoseNocturne />);
    expect(container.querySelector(".rose-chamber")).toBeNull();
  });

  it("mounts the velvet chamber, lamp, silk and pearl motes", () => {
    document.documentElement.dataset.theme = "luft.rose";
    const { container } = render(<RoseNocturne />);
    expect(container.querySelector(".rose-velvet")).not.toBeNull();
    expect(container.querySelector(".rose-lamp")).not.toBeNull();
    expect(container.querySelector(".rose-silk")).not.toBeNull();
    expect(container.querySelector(".rose-grain")).not.toBeNull();
    expect(container.querySelectorAll(".rose-mote")).toHaveLength(12);
  });
});
