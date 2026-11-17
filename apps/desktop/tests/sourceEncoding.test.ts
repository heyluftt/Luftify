import { describe, expect, it } from "vitest";

// UTF-8 text read as Windows-1252 once turned "…" into "â€¦" in the player
// bar. These sequences never occur in German or English copy.
const MOJIBAKE = /â€|Ã[\u0080-\u00bf]/;

const sources = import.meta.glob<string>("../src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("source encoding", () => {
  it("contains no double-encoded characters", () => {
    const broken = Object.entries(sources)
      .filter(([, text]) => MOJIBAKE.test(text))
      .map(([path]) => path);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(broken).toEqual([]);
  });
});
