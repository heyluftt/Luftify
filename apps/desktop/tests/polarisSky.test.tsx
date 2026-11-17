import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PolarisSky } from "../src/features/theme/PolarisSky";

describe("PolarisSky", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it("stays unmounted outside Polaris", () => {
    document.documentElement.dataset.theme = "luft.dark";
    const { container } = render(<PolarisSky />);
    expect(container.querySelector(".polaris-sky")).toBeNull();
  });

  it("mounts the pole, the Milky Way, star layers and meteors for Polaris", () => {
    document.documentElement.dataset.theme = "luft.polaris";
    const { container } = render(<PolarisSky />);
    expect(container.querySelector(".polaris-north")).not.toBeNull();
    expect(container.querySelector(".polaris-rotor .polaris-milkyway")).not.toBeNull();
    expect(container.querySelector(".polaris-ridge")).not.toBeNull();
    expect(container.querySelectorAll(".polaris-rotor .polaris-stars")).toHaveLength(5);
    expect(container.querySelectorAll(".polaris-meteor")).toHaveLength(2);
    expect(container.querySelector(".polaris-aurora")).toBeNull();
  });
});
