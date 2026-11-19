export type Freshness = 'fresh' | 'delayed' | 'stale' | 'lost' | 'unknown';
export function freshness(time: number | null, now: number): Freshness {
  if (time === null || !Number.isFinite(time) || !Number.isFinite(now) || time > now) return 'unknown';
  const age = now - time;
  return age <= 20 ? 'fresh' : age <= 60 ? 'delayed' : age <= 120 ? 'stale' : 'lost';
}
