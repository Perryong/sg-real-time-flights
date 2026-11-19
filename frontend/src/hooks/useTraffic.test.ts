// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTraffic } from "./useTraffic";
import { snapshot } from "../data/testHelpers";
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage: any;
  onclose: any;
  onerror: any;
  onopen: any;
  constructor() {
    Socket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  send(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each(["message-first", "visibility-first"])(
  "rejects queued pre-sleep messages on wake (%s)",
  (order) => {
    const { result } = renderHook(() => useTraffic());
    const s = Socket.instances[0];
    const f = snapshot(0, "live-epoch", 1700000000);
    f.mode = "live";
    f.status.mode = "live";
    f.scenario_time = null;
    for (const t of f.tracks)
      for (const o of [...t.history, t.latest]) o.mode = "live";
    act(() => s.send(f));
    const queued = s.onmessage;
    const oldHeartbeat = {
      type: "heartbeat",
      epoch: f.epoch,
      sequence: 0,
      server_time: f.server_time,
      status: f.status,
    };
    vi.setSystemTime(1700000121000);
    act(() => {
      if (order === "visibility-first")
        document.dispatchEvent(new Event("visibilitychange"));
      queued({ data: JSON.stringify(oldHeartbeat) });
      if (order === "message-first")
        document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.getNow()).toBeGreaterThanOrEqual(1700000121);
    expect(Socket.instances.length).toBeGreaterThan(1);
    // An obsolete callback must also remain ineligible during replacement.
    act(() => queued({ data: JSON.stringify({ ...f, sequence: 99 }) }));
    expect(result.current.getNow()).toBeGreaterThanOrEqual(1700000121);
  },
);
