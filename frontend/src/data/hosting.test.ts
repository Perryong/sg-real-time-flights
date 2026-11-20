import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it("keeps local asset, data and websocket URLs on the local app",async()=>{
  vi.stubEnv("BASE_URL","/");vi.stubEnv("VITE_STATIC_HOST","false");vi.stubEnv("VITE_API_BASE_URL","");
  const h=await import("./hosting");
  expect(h.assetUrl("models/generic-aircraft.glb")).toBe("/models/generic-aircraft.glb");
  expect(h.airportUrl).toBe("/api/airport");
  expect(h.socketUrl("http://localhost:5177")).toBe("ws://localhost:5177/ws/aircraft");
  expect(h.liveAvailable).toBe(true);
});
it("serves a clearly separate static demo when Pages has no backend",async()=>{
  vi.stubEnv("BASE_URL","/sg-real-time-flights/");vi.stubEnv("VITE_STATIC_HOST","true");vi.stubEnv("VITE_API_BASE_URL","");
  const h=await import("./hosting");
  expect(h.assetUrl("models/generic-aircraft.glb")).toBe("/sg-real-time-flights/models/generic-aircraft.glb");
  expect(h.airportUrl).toBe("/sg-real-time-flights/data/airport.json");
  expect(h.fixtureUrl("simulated")).toBe("/sg-real-time-flights/data/changi-demo.json");
  expect(h.liveAvailable).toBe(false);
  expect(h.socketUrl("https://perryong.github.io")).toBeNull();
});
it("connects hosted live traffic only to the configured secure backend",async()=>{
  vi.stubEnv("BASE_URL","/sg-real-time-flights/");vi.stubEnv("VITE_STATIC_HOST","true");vi.stubEnv("VITE_API_BASE_URL","https://tracker.example.org/");
  const h=await import("./hosting");
  expect(h.socketUrl("https://perryong.github.io")).toBe("wss://tracker.example.org/ws/aircraft");
  expect(h.liveAvailable).toBe(true);
});
it("does not enable an insecure backend on the hosted app",async()=>{
  vi.stubEnv("VITE_STATIC_HOST","true");vi.stubEnv("VITE_API_BASE_URL","http://tracker.example.org");
  const h=await import("./hosting");
  expect(h.liveAvailable).toBe(false);
});
