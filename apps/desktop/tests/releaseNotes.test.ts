import { describe, expect, it } from "vitest";
import { newestSection } from "../src/features/updates/releaseNotes";

describe("release notes", () => {
  it("takes only the newest version's points", () => {
    const text = "# 0.1.10\n\n- Neu A\n- Neu B\n\n# 0.1.9\n\n- Alt\n";
    expect(newestSection(text)).toEqual({ version: "0.1.10", lines: ["Neu A", "Neu B"] });
  });
});
