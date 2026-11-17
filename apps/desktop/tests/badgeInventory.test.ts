import { describe, expect, it } from "vitest";
import { ownedBadges, shownBadges } from "../src/features/friends/badgeInventory";

describe("badge inventory", () => {
  const catalog = [{ id: "b1", label: "DJ", icon: "music", color: "gold" }, { id: "b2", label: "Nachteule", icon: "moon", color: "violet" }];
  const owned = ownedBadges({ roles: ["tester", "luft"], badges: ["b1", "b2", "gone"] }, catalog);

  it("owns roles in rank order, then badges the catalog knows", () => {
    expect(owned.map((badge) => badge.key)).toEqual(["role:luft", "role:tester", "badge:b1", "badge:b2"]);
  });

  it("shows everything without a choice, otherwise the chosen ones still owned, in order", () => {
    expect(shownBadges(owned, null)).toHaveLength(4);
    expect(shownBadges(owned, ["badge:b2", "role:dev", "role:luft"]).map((badge) => badge.key)).toEqual(["badge:b2", "role:luft"]);
    expect(shownBadges(owned, [])).toEqual([]);
  });

  it("adds reached achievements, known ones only, after everything else", () => {
    const withQuests = ownedBadges({ roles: ["dev"], achievements: ["along", "dragon", "first_friend"] }, catalog);
    expect(withQuests.map((badge) => badge.key)).toEqual(["role:dev", "quest:first_friend", "quest:along"]);
  });
});
