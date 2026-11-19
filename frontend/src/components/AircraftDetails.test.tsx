// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AircraftDetails from "./AircraftDetails";
import { track } from "../data/testHelpers";
afterEach(cleanup);
it("shows unknown measurements and source timing rather than fabricated zeros", () => {
  const t = track();
  t.latest.alt_baro_m = null;
  t.latest.alt_geom_m = null;
  t.latest.speed_mps = null;
  t.latest.callsign = null;
  render(
    <AircraftDetails
      track={t}
      now={1010}
      follow={false}
      onFollow={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("fixture")).toBeTruthy();
  expect(screen.getByText("a")).toBeTruthy();
  expect(screen.getByText(/Observed position time/i)).toBeTruthy();
});
it("escapes provider text and labels estimated phases", () => {
  const t = track();
  t.latest.callsign = "<img src=x onerror=alert(1)>";
  t.phase.phase = "landing_candidate";
  render(
    <AircraftDetails
      track={t}
      now={1010}
      follow={false}
      onFollow={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.getByText(/Landing candidate/i)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
});
