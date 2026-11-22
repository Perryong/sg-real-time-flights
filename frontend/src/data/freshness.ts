export type Freshness = "fresh" | "delayed" | "stale" | "lost" | "unknown";
export function freshness(time: number | null, now: number): Freshness {
  if (
    time === null ||
    !Number.isFinite(time) ||
    !Number.isFinite(now) ||
    time > now
  )
    return "unknown";
  const age = now - time;
  return age <= 20
    ? "fresh"
    : age <= 60
      ? "delayed"
      : age <= 120
        ? "stale"
        : "lost";
}

export function effectiveUpstreamState(status:{upstream_state:string;last_success:number|null},transport:string,now:number) {
  return transport!=='connected'||status.last_success===null||now-status.last_success>60
    ? 'unavailable' : status.upstream_state;
}
