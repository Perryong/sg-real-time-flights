/** Optional, bounded instrumentation. The benchmark opts in before page load. */
export interface SceneMetrics {
  frames: number[];
  ready: boolean;
  failed: boolean;
  lastRender: number;
  aircraftCount: number;
  visibleCount: number;
}
declare global {
  interface Window {
    __changiBenchmark?: SceneMetrics;
  }
}
export function summarizeScene(
  metrics: SceneMetrics,
  now: number,
  expected: number,
) {
  const intervals = metrics.frames
    .slice(1)
    .map((t, i) => t - metrics.frames[i]);
  const sorted = intervals.slice().sort((a, b) => a - b);
  const valid =
    metrics.ready &&
    !metrics.failed &&
    now - metrics.lastRender < 1000 &&
    metrics.aircraftCount === expected &&
    metrics.visibleCount === expected &&
    intervals.length > 1;
  return {
    valid,
    scene_frames: metrics.frames.length,
    visible_aircraft: metrics.visibleCount,
    aircraft_entities: metrics.aircraftCount,
    mean_fps: intervals.length
      ? (intervals.length * 1000) / intervals.reduce((a, b) => a + b, 0)
      : 0,
    p95_frame_ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
  };
}
