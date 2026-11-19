import { describe, expect, it } from "vitest";
import { freshness } from "./freshness";
describe("position age, never message age", () => {
  it.each([
    [20, "fresh"],
    [21, "delayed"],
    [60, "delayed"],
    [61, "stale"],
    [120, "stale"],
    [121, "lost"],
  ] as const)("age %s yields %s", (age, state) =>
    expect(freshness(1000, 1000 + age)).toBe(state),
  );
  it("does not invent freshness from missing or future time", () => {
    expect(freshness(null, 1000)).toBe("unknown");
    expect(freshness(1100, 1000)).toBe("unknown");
  });
});
