// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TrafficList from "./TrafficList";
import SourceDetails from "./SourceDetails";
afterEach(cleanup);
const props = { tracks: [], selected: null, onSelect: () => {}, now: 0, query: "", setQuery: () => {}, filter: "all", setFilter: () => {}, onDemo: () => {}, unavailable: false };
it("credits the live provider with a homepage link, including during outages", () => {
  const { rerender } = render(<TrafficList {...props} mode="live" />);
  expect(screen.getByRole("link", { name: "ADSB.fi" }).getAttribute("href")).toBe("https://adsb.fi/");
  rerender(<TrafficList {...props} mode="live" unavailable />);
  expect(screen.getByRole("link", { name: "ADSB.fi" })).toBeTruthy();
});
it("keeps demo attribution explicitly synthetic", () => {
  render(<TrafficList {...props} mode="simulated" />);
  expect(screen.getByText("Synthetic scenario · not real flights")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "ADSB.fi" })).toBeNull();
});
it("explains the personal-use data source in source details", () => {
  render(<SourceDetails airport={null} transport="connected" onClose={() => {}} />);
  expect(screen.getByRole("link", { name: /ADSB.fi/ }).getAttribute("href")).toBe("https://adsb.fi/");
  expect(screen.getByText(/personal, non-commercial/i)).toBeTruthy();
});
