import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RedlineEmbers } from "../src/features/theme/RedlineEmbers";

describe("RedlineEmbers", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it("stays unmounted outside Redline", () => {
    document.documentElement.dataset.theme = "luft.dark";
    const { container } = render(<RedlineEmbers />);
    expect(container.querySelector(".redline-atmosphere")).toBeNull();
  });

  it("mounts the fire bed, tongues and ignition for Redline", () => {
    document.documentElement.dataset.theme = "luft.redline";
    const { container } = render(<RedlineEmbers />);
    expect(container.querySelector(".redline-bed")).not.toBeNull();
    expect(container.querySelector(".redline-ignition")).not.toBeNull();
    expect(container.querySelectorAll(".redline-flame")).toHaveLength(5);
    expect(container.querySelectorAll(".redline-ember")).toHaveLength(16);
  });
});
