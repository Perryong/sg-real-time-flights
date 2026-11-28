// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { JourneyPanel } from "./JourneyPanel";
import type { Airport, Journey } from "./types";

afterEach(cleanup);

const airport = (icao: string, iata: string, name: string, city: string): Airport =>
  ({ icao, iata, name, city, lat: null, lon: null });
const departure = 1_800_000_000;
const journey: Journey = {
  id: "abc123",
  callsign: "TEST123",
  status: "arrived",
  origin: airport("WSSS", "SIN", "Changi Airport", "Singapore"),
  destination: airport("WMKK", "KUL", "Kuala Lumpur International Airport", "Kuala Lumpur"),
  plannedDestination: airport("VTBS", "BKK", "Suvarnabhumi Airport", "Bangkok"),
  source: "Sample provider",
  departureTime: departure - 300,
  arrivalTime: departure + 1_800,
  points: [
    { time: departure, lat: 1, lon: 103, altitude_ft: 0, estimated: false },
    { time: departure + 60, lat: 2, lon: 103, altitude_ft: 1_500, estimated: false },
    { time: departure + 120, lat: 3, lon: 103, altitude_ft: null, estimated: false },
    { time: departure + 180, lat: 4, lon: 103, altitude_ft: 8_000, estimated: true },
    { time: departure + 1_200, lat: 5, lon: 103, altitude_ft: 5_000, estimated: false },
  ],
};
const props = { selectedTime: null, onSelectTime: vi.fn(), onFit: vi.fn(), loading: false };

it("distinguishes the actual arrival from a diversion's originally intended airport", () => {
  render(<JourneyPanel {...props} journey={journey} />);
  expect(within(screen.getByRole("region", { name: "Flight journey" })).getByText("Sample provider")).toBeTruthy();
  expect(screen.getByText("Arrival").parentElement?.textContent).toContain("KUL");
  expect(screen.getByText("Originally intended arrival").parentElement?.textContent).toContain("BKK");
  expect(screen.getByText("Diverted")).toBeTruthy();
});

it("identifies an unknown airport in a confirmed airborne leg", () => {
  render(<JourneyPanel {...props} journey={{ ...journey, status: "airborne", origin: null }} />);
  expect(screen.getByText("Departure").parentElement?.textContent).toContain("Unknown airport");
  expect(screen.getByText("Intended arrival").parentElement?.textContent).toContain("KUL");
  expect(screen.queryByText("Diverted")).toBeNull();
});

it("retains zero, unknown and estimated altitude when selecting map positions", () => {
  const onSelectTime = vi.fn();
  function LinkedPanel() {
    const [selectedTime, setSelectedTime] = useState<number | null>(null);
    return <JourneyPanel {...props} journey={journey} selectedTime={selectedTime} onSelectTime={(time) => {
      setSelectedTime(time);
      onSelectTime(time);
    }} />;
  }
  render(<LinkedPanel />);
  const slider = screen.getByRole("slider", { name: "Altitude observation" });
  expect(slider.getAttribute("aria-valuetext")).toContain("5,000 ft");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider.getAttribute("aria-valuetext")).toMatch(/· 0 ft$/);
  expect(onSelectTime).toHaveBeenLastCalledWith(departure);
  fireEvent.change(slider, { target: { value: "2" } });
  expect(slider.getAttribute("aria-valuetext")).toContain("Altitude unknown");
  expect(onSelectTime).toHaveBeenLastCalledWith(departure + 120);
  fireEvent.change(slider, { target: { value: "3" } });
  expect(slider.getAttribute("aria-valuetext")).toMatch(/Estimated position.*8,000 ft/);
  expect(onSelectTime).toHaveBeenLastCalledWith(departure + 180);
});

it("reports missing coverage at either end and within the track", () => {
  render(<JourneyPanel {...props} journey={journey} />);
  expect(screen.getByText(/Observations begin after departure/)).toBeTruthy();
  expect(screen.getByText(/Observations end before arrival/)).toBeTruthy();
  expect(screen.getByText(/1 track gap/)).toBeTruthy();
  expect(screen.getByText(/1 altitude unavailable/)).toBeTruthy();
});

it("draws only measured segments with altitude and continuous coverage", () => {
  const points = [
    { time: departure, altitude_ft: 0, estimated: false },
    { time: departure + 60, altitude_ft: 1_500, estimated: false },
    { time: departure + 120, altitude_ft: null, estimated: false },
    { time: departure + 180, altitude_ft: 5_000, estimated: false },
    { time: departure + 240, altitude_ft: 8_000, estimated: false, gapBefore: true },
    { time: departure + 300, altitude_ft: 9_000, estimated: false },
    { time: departure + 360, altitude_ft: 9_000, estimated: true },
    { time: departure + 420, altitude_ft: 9_000, estimated: false },
    { time: departure + 1_500, altitude_ft: 2_000, estimated: false },
  ].map((point) => ({ ...point, lat: 0, lon: 103 }));
  const { container } = render(<JourneyPanel {...props} journey={{ ...journey, points }} />);
  const trace = container.querySelector(".journey-plot-trace")?.getAttribute("d");
  expect(trace?.match(/L/g)).toHaveLength(2);
  expect(screen.getByText(/2 track gaps/)).toBeTruthy();
});

it("labels regional observations while leg data is loading and fits the available track", () => {
  const regional: Journey = { ...journey, status: "regional", origin: null, destination: null };
  render(<JourneyPanel {...props} journey={regional} loading message="Journey lookup unavailable." />);
  expect(screen.getByText("Regional observations")).toBeTruthy();
  expect(screen.getAllByText("Unknown airport")).toHaveLength(2);
  expect(screen.getByRole("status").textContent).toContain("Looking up");
  expect(screen.getByText("Journey lookup unavailable.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fit journey" }));
  expect(props.onFit).toHaveBeenCalledOnce();
});
