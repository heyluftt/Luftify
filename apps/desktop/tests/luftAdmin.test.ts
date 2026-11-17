import { describe, expect, it } from "vitest";
import { compareVersions, newestVersion, type AdminUser } from "../src/features/friends/admin/adminApi";

describe("Luft corner", () => {
  it("compares versions part by part and finds the newest one running", () => {
    expect(compareVersions("0.1.12", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.9")).toBe(0);
    const users = ["0.1.9", null, "0.1.12", "0.1.11"].map((appVersion) => ({ appVersion }) as AdminUser);
    expect(newestVersion(users)).toBe("0.1.12");
    expect(newestVersion([])).toBeNull();
  });
});
