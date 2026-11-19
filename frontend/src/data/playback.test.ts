import { expect, it } from "vitest";
import { PlaybackController } from "./playback";
import { snapshot } from "./testHelpers";
it("uses original scenario time and pause freezes expiry while wall time advances", () => {
  let wall = 0;
  const p = new PlaybackController(
    [
      snapshot(0, "demo", 1000),
      snapshot(1, "demo", 1010),
      snapshot(2, "demo", 1020),
    ],
    () => wall,
  );
  p.play();
  wall = 15;
  p.tick();
  expect(p.time).toBe(1015);
  p.pause();
  wall = 100;
  p.tick();
  expect(p.time).toBe(1015);
  p.play();
  wall = 102;
  p.tick();
  expect(p.time).toBe(1017);
});
it("seeking never leaks a future sample and restart clears current state", () => {
  const p = new PlaybackController(
    [
      snapshot(0, "demo", 1000),
      snapshot(1, "demo", 1010),
      snapshot(2, "demo", 1020),
    ],
    () => 0,
  );
  p.seek(1005);
  expect(p.tick().sequence).toBe(0);
  p.seek(1020);
  expect(p.tick().sequence).toBe(2);
  p.seek(1000);
  expect(p.tick().sequence).toBe(0);
});
