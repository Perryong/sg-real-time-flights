import { describe, expect, it } from "vitest";
import { freshness, effectiveUpstreamState } from "./freshness";
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

it('marks cached healthy status unavailable after transport failure or source age',()=>{
  const status={upstream_state:'healthy',last_success:1000};
  expect(effectiveUpstreamState(status,'unavailable',1001)).toBe('unavailable');
  expect(effectiveUpstreamState(status,'connected',1061)).toBe('unavailable');
  expect(effectiveUpstreamState(status,'connected',1015)).toBe('healthy');
});
