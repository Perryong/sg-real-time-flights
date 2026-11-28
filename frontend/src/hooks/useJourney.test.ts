// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Track } from "../data/types";
import { regionalJourney, useJourney } from "./useJourney";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function aircraft(callsign: string | null, time = Math.floor(Date.now() / 1000)) {
  const id = "live:icao24:76b4ec";
  const track: Track = {
    id, session_id:"session", history:[],
    phase:{phase:"airborne",confidence:"low",candidate_runways:[],evidence_times:[],reasons:[],rule_version:"test"},
    latest:{
      id, provider:"receiver", provider_id:"76b4ec", session_id:"session", mode:"live", callsign,
      registration:"9V-MGL", aircraft_type:"B738", lat:1.36, lon:104, alt_baro_m:1000, alt_geom_m:null,
      position_time:time, receipt_time:time, provider_time:null, message_time:null, ground:false,
      speed_mps:null, track_deg:null, heading_deg:null, vertical_rate_mps:null,
      timestamp_quality:"derived", source_category:null, quality:{}, raw:{},
    },
  };
  return track;
}
const leg = (track:Track) => ({ ...regionalJourney(track), status:"airborne", id:"pinned-dated-leg" });
const response = (journey: unknown) => new Response(JSON.stringify({journey}));

it("keeps the selection pinned across feed updates and drops a late response after switching legs", async () => {
  const first = aircraft("SIA132");
  const next = aircraft("SIA131", first.latest.receipt_time + 60);
  let delayed!: (r: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { delayed = resolve; }))
    .mockResolvedValue(response(leg(next)));
  vi.stubGlobal("fetch", fetch);
  const {result,rerender} = renderHook((track:Track) => useJourney(track, true), {initialProps:first});
  rerender(aircraft("SIA132", first.latest.receipt_time + 10));
  expect(fetch).toHaveBeenCalledTimes(1);
  rerender(next);
  await waitFor(() => expect(result.current.journey?.status).toBe("airborne"));
  await act(async () => delayed(response(leg(first))));
  expect(result.current.journey?.callsign).toBe("SIA131");
  const sameCallLater = aircraft("SIA131", next.latest.receipt_time + 86400);
  fetch.mockResolvedValueOnce(response(null));
  rerender(sameCallLater);
  expect(result.current.journey?.status).toBe("regional");
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(new URL(String(fetch.mock.lastCall?.[0]), "https://example.test").searchParams.get("observed_at")).toBe(String(sameCallLater.latest.position_time));
});

it("shows local evidence for a missing callsign and excludes another leg's observations", () => {
  const track = aircraft(null);
  track.history = [{ ...track.latest, callsign: "OTHER1", position_time: track.latest.position_time! - 10 }];
  Object.assign(track.latest, {alt_baro_m: 0, alt_geom_m: 10});
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const {result} = renderHook(() => useJourney(track,true));
  expect(fetch).not.toHaveBeenCalled();
  expect(result.current.journey?.points).toHaveLength(1);
  expect(result.current.journey?.points[0].altitude_ft).toBe(0);
});

it("keeps the regional track usable if a provider response contains an invalid timestamp", async () => {
  const track = aircraft("SIA132");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({...leg(track), points:[{time:"unknown"}]})));
  const {result} = renderHook(() => useJourney(track, true));
  await waitFor(() => expect(result.current.message).toMatch(/temporarily unavailable/));
  expect(result.current.journey?.status).toBe("regional");
});

it("retries an unconfirmed departure with its latest observation before freezing its bookmark", async () => {
  vi.useFakeTimers();
  try {
    const first = aircraft("SIA132");
    const next = aircraft("SIA132",first.latest.receipt_time + 300);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({journey:null,retryable:true})))
      .mockResolvedValueOnce(response(leg(next))).mockResolvedValueOnce(response(leg(next)));
    vi.stubGlobal("fetch",fetch);
    const {rerender} = renderHook((track:Track) => useJourney(track,true),{initialProps:first});
    await act(async () => {});
    rerender(next);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    rerender(aircraft("SIA132",next.latest.receipt_time + 300));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    const queries = fetch.mock.calls.map(([url]) => new URL(url,"https://example.test").searchParams);
    expect(queries.map(q => q.get("observed_at"))).toEqual(
      [first.latest.position_time,next.latest.position_time,next.latest.position_time].map(String));
    expect(queries[2].get("id")).toBe("pinned-dated-leg");
  } finally {vi.useRealTimers();}
});

it("retains the leg when the new receiver omits registration, and clears history on a withheld result", async () => {
  vi.useFakeTimers();
  try {
    const first = aircraft("SIA132");
    const fetch = vi.fn().mockResolvedValueOnce(response(leg(first)))
      .mockResolvedValueOnce(new Response(JSON.stringify({journey:null,reason:"Flight unavailable."})));
    vi.stubGlobal("fetch",fetch);
    const {result,rerender} = renderHook((track:Track) => useJourney(track,true),{initialProps:first});
    await act(async () => {});
    const updated = aircraft("SIA132", first.latest.receipt_time + 15);
    updated.latest.registration = null;
    rerender(updated);
    expect(result.current.journey?.status).toBe("airborne");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(result.current.journey?.status).toBe("regional");
    expect(result.current.message).toBe("Flight unavailable.");
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {vi.useRealTimers();}
});
