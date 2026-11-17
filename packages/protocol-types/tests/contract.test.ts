import { describe, expect, it } from "vitest";
import { MAX_SEARCH_QUERY_LENGTH } from "../src/contract";

describe("protocol constants", () => {
  it("keeps the search query limit the backend validates", () => {
    expect(MAX_SEARCH_QUERY_LENGTH).toBe(200);
  });
});
