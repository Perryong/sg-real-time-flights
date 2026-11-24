import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot, Mode } from "../data/types";
import { acceptSnapshot, isStatus, type StreamState } from "../data/stream";
import { PlaybackController } from "../data/playback";
import { fixtureUrl, liveAvailable, socketUrl, httpFeedUrl } from "../data/hosting";

import { startPolling } from "../data/polling";

export function useTraffic(region="singapore") {
  const [mode, setMode] = useState<Mode>(liveAvailable ? "live" : "simulated"),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [transport, setTransport] = useState("connecting"),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now() / 1000),
    [playing, setPlaying] = useState(true);
  const generation = useRef(0),
    offset = useRef(0),
    synchronized = useRef(false),
    playback = useRef<PlaybackController | null>(null);
  const getNow = useCallback(
    () => playback.current?.time ?? Date.now() / 1000 + offset.current,
    [],
  );
  useEffect(() => {
    let disposed = false,
      socket: WebSocket | undefined,
      reconnect: ReturnType<typeof setTimeout> | undefined,
      attempt = 0,
      lastMessage = Date.now();
    const abort = new AbortController();
    let stopPolling: (()=>void)|undefined;
    const myGeneration = ++generation.current;
    let connectionId = 0;
    let state: StreamState = { connectionId: 0, snapshot: null };
    setSnapshot(null);
    setError(null);
    setTransport(mode === "live" ? "connecting" : "loading fixture");
    playback.current?.dispose();
    playback.current = null;
    const active = () => !disposed && generation.current === myGeneration;
    const synchronize = (serverTime: number) => {
      const candidate = serverTime - Date.now() / 1000;
      // A delayed frame may advance our estimate, but must never rewind it.
      offset.current = synchronized.current
        ? Math.max(offset.current, candidate)
        : candidate;
      synchronized.current = true;
    };
    const replaceConnection = () => {
      connectionId++; // Invalidate queued callbacks before closing the old socket.
      clearTimeout(reconnect);
      socket?.close();
      setNow(getNow());
      connect();
    };
    const connect = () => {
      if (!active()) return;
      connectionId++;
      const id = connectionId;
      state = { connectionId: id, snapshot: null };
      lastMessage = Date.now();
      setTransport("connecting");
      const url = socketUrl(location.origin);
      if (!url) { setTransport("unavailable"); return; }
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        if (!active() || id !== connectionId) return;
        if (Date.now() - lastMessage > 30000) {
          replaceConnection();
          return;
        }
        try {
          const data = JSON.parse(event.data);
          if (
            data.type === "heartbeat" &&
            isStatus(data.status) &&
            data.status.mode === "live" &&
            typeof data.server_time === "number" &&
            Number.isFinite(data.server_time) &&
            state.snapshot?.epoch === data.epoch
          ) {
            lastMessage = Date.now();
            synchronize(data.server_time);
            setTransport("connected");
            setSnapshot((old) => (old ? { ...old, status: data.status } : old));
            return;
          }
          if (data.mode !== "live") return;
          const next = acceptSnapshot(state, data, id);
          if (next === state) return;
          state = next;
          synchronize(data.server_time);
          lastMessage = Date.now();
          attempt = 0;
          setError(null);
          setTransport("connected");
          setSnapshot(next.snapshot);
        } catch {
          setError("Invalid feed message ignored");
        }
      };
      socket.onclose = () => {
        if (!active() || id !== connectionId) return;
        setTransport("reconnecting");
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) *
          (0.8 + Math.random() * 0.2);
        reconnect = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };
    if (mode === "live" && httpFeedUrl) {
      stopPolling = startPolling(region==='singapore'?httpFeedUrl:`${httpFeedUrl}?region=${encodeURIComponent(region)}`, (data,responseNow) => {
        if (!active()) return;
        const old = state.snapshot;
        if (old && old.epoch === data.epoch && data.sequence < old.sequence) return;
        state = {connectionId, snapshot:data};
        // Cached server_time is the collection time, not the response time.
        // Use the separate response clock plus CDN age, not collection time.
        if(responseNow !== undefined) synchronize(responseNow);
        setSnapshot(data); setError(null); lastMessage=Date.now();
      }, value => { if(active()) setTransport(value); });
    } else if (mode === "live") connect();
    else
      fetch(
        fixtureUrl(mode),
        { signal: abort.signal },
      )
        .then((r) => {
          if (!r.ok) throw Error("Fixture unavailable");
          return r.json();
        })
        .then((data) => {
          if (!active()) return;
          playback.current = new PlaybackController(
            data.frames,
            () => performance.now() / 1000,
          );
          playback.current.play();
          setPlaying(true);
          setSnapshot(playback.current.tick());
          setTransport("local playback");
        })
        .catch((e) => {
          if (active()) {
            setError(String(e));
            setTransport("unavailable");
          }
        });
    const tick = setInterval(() => {
      if (!active()) return;
      if (playback.current) {
        setSnapshot(playback.current.tick());
        setPlaying(playback.current.playing);
      } else if (
        socket &&
        Date.now() - lastMessage > 30000 &&
        socket.readyState === WebSocket.OPEN
      )
        replaceConnection();
      setNow(getNow());
    }, 250);
    const resume = () => {
      setNow(getNow());
      if (
        document.visibilityState === "visible" &&
        mode === "live" && !httpFeedUrl &&
        Date.now() - lastMessage > 30000
      )
        replaceConnection();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      abort.abort();
      stopPolling?.();
      clearInterval(tick);
      clearTimeout(reconnect);
      if (socket?.readyState === WebSocket.CONNECTING) {
        const pending = socket;
        pending.onopen = () => pending.close();
      } else socket?.close();
      playback.current?.dispose();
      playback.current = null;
      document.removeEventListener("visibilitychange", resume);
    };
  }, [mode, getNow, region]);
  const togglePlay = () => {
    const p = playback.current;
    if (p) {
      p.playing ? p.pause() : p.play();
      setPlaying(p.playing);
      setNow(getNow());
    }
  };
  const seek = (time: number) => {
    const p = playback.current;
    if (p) {
      p.seek(time);
      setSnapshot(p.tick());
      setNow(p.time);
    }
  };
  return {
    mode,
    setMode,
    snapshot,
    transport,
    error,
    now,
    getNow,
    playing,
    togglePlay,
    seek,
    start: playback.current?.start ?? 0,
    end: playback.current?.end ?? 0,
  };
}
