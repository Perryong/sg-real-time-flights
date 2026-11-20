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
it("credits the configured FlyItalyADSB source and explains its own status", () => {
  const sources={flyitalyadsb:{enabled:true,state:"healthy",error_code:null,last_attempt:0,last_success:1700000000,next_retry:1700000030,requests:1,remaining_credits:null}};
  const {unmount}=render(<TrafficList {...props} mode="live" sources={sources} />);
  expect(screen.getByRole("link", {name:"FlyItalyADSB"}).getAttribute("href")).toBe("https://flyitalyadsb.com/");
  unmount();
  const status={mode:"live" as const,upstream_state:"healthy",message:"Available",error_code:null,last_attempt:0,last_success:1700000000,next_retry:30,newest_position_time:0,geometry_edition:"test",counters:{},sources};
  render(<SourceDetails airport={null} transport="connected" status={status} onClose={()=>{}} />);
  expect(screen.getByText("FlyItalyADSB · healthy")).toBeTruthy();
});
it("explains the personal-use data source in source details", () => {
  render(<SourceDetails airport={null} transport="connected" onClose={() => {}} />);
  expect(screen.getByRole("link", { name: /ADSB.fi/ }).getAttribute("href")).toBe("https://adsb.fi/");
  expect(screen.getByText(/personal, non-commercial/i)).toBeTruthy();
});
it("credits OpenSky when the ground supplement is active even during an outage", () => {
  render(<TrafficList {...props} mode="live" sources={{opensky:{enabled:true,state:"paused",error_code:"403",last_attempt:0,last_success:null,next_retry:null,requests:1,remaining_credits:null}}} />);
  expect(screen.getByRole("link",{name:"OpenSky"}).getAttribute("href")).toBe("https://opensky-network.org/");
});
it("explains that OpenSky is waiting for permission without claiming it is live", () => {
  const status={mode:"live" as const,upstream_state:"healthy",message:"Live observations available",error_code:null,last_attempt:0,last_success:0,next_retry:30,newest_position_time:0,geometry_edition:"test",counters:{},sources:{opensky:{enabled:false,state:"disabled",error_code:"permission_required",last_attempt:null,last_success:null,next_retry:null,requests:0,remaining_credits:null}}};
  render(<SourceDetails airport={null} transport="connected" status={status} onClose={()=>{}} />);
  expect(screen.getByText(/Waiting for OpenSky use permission/)).toBeTruthy();
  expect(screen.getByText(/does not identify every parked aircraft/)).toBeTruthy();
});
it("shows ADSB.fi's own paused state even when OpenSky is healthy", () => {
  const status={mode:"live" as const,upstream_state:"degraded",message:"Partial availability",error_code:null,last_attempt:0,last_success:1700000000,next_retry:30,newest_position_time:0,geometry_edition:"test",counters:{},sources:{"adsb.fi":{enabled:true,state:"paused",error_code:"403",last_attempt:0,last_success:null,next_retry:null,requests:1,remaining_credits:null}}};
  render(<SourceDetails airport={null} transport="connected" status={status} onClose={()=>{}} />);
  expect(screen.getByText("ADSB.fi · paused")).toBeTruthy();
  expect(screen.getByText("Access notice: 403")).toBeTruthy();
});
