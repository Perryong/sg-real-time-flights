import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Cartesian3,
  Color,
  UrlTemplateImageryProvider,
  ImageryLayer,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  HeadingPitchRange,
  Math as CMath,
  EllipsoidTerrainProvider,
  JulianDate,
} from "cesium";
import type { Airport, Track } from "../data/types";
import { addAirport } from "./airport";
import { AircraftLayer } from "./aircraft";
import type {} from "./performance";
import { DarkMapProvider } from "./imagery";
export type CameraAction = {
  kind: "overview" | "north" | "in" | "out" | "runway";
  id?: string;
  nonce: number;
};
interface Props {
  airport: Airport | null;
  tracks: Track[];
  selected: string | null;
  follow: boolean;
  night: boolean;
  view: "overhead" | "3d";
  trails: boolean;
  geometry: boolean;
  action: CameraAction;
  getNow: () => number;
  onSelect: (id: string) => void;
  onError: (message: string) => void;
  onReady: () => void;
  onUnavailable: () => void;
  onVisibleCount: (n: number) => void;
}
export default function MapScene(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    viewerRef = useRef<Viewer | null>(null),
    layer = useRef<AircraftLayer | null>(null),
    latest = useRef(props),
    [ready, setReady] = useState(false);
  latest.current = props;
  useEffect(() => {
    if (!container.current) return;
    const modelAbort = new AbortController();
    const metrics = window.__changiBenchmark;
    let contextLost: (() => void) | undefined;
    let viewer: Viewer;
    let handler: ScreenSpaceEventHandler | undefined;
    try {
      viewer = new Viewer(container.current, {
        showRenderLoopErrors: false,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        shouldAnimate: false,
        skyBox: false,
        skyAtmosphere: false,
        requestRenderMode: false,
      });
      viewerRef.current = viewer;
      viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5);
      viewer.scene.backgroundColor = Color.fromCssColorString("#08141e");
      viewer.scene.globe.baseColor = Color.fromCssColorString("#102833");
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 3000000;
      const options = {
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maximumLevel: 18,
        credit: "© OpenStreetMap contributors · map colors adapted",
      };
      const imagery = new DarkMapProvider(options);
      const dayImagery = new UrlTemplateImageryProvider(options);
      imagery.errorEvent.addEventListener(() =>
        latest.current.onError(
          "Map imagery is unavailable. Airport geometry remains visible.",
        ),
      );
      viewer.imageryLayers.add(new ImageryLayer(imagery, { brightness: 0.8 }));
      viewer.imageryLayers.add(new ImageryLayer(dayImagery, { show: false }));
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(103.96, 1.36, 125000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      layer.current = new AircraftLayer(viewer, () => latest.current.getNow());
      fetch("/models/generic-aircraft.glb", { signal: modelAbort.signal })
        .then(async (r) => {
          if (!r.ok) throw Error();
          const bytes = await r.arrayBuffer();
          if (new DataView(bytes).getUint32(0, true) !== 0x46546c67)
            throw Error();
        })
        .catch(() => {
          if (!modelAbort.signal.aborted) {
            if (layer.current) layer.current.models = false;
            latest.current.onError(
              "Aircraft model unavailable; showing position markers.",
            );
          }
        });
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: any }) => {
        const picked = viewer.scene.pick(click.position);
        if (picked?.id?.id && layer.current?.tracks.has(picked.id.id))
          latest.current.onSelect(picked.id.id);
      }, ScreenSpaceEventType.LEFT_CLICK);
      let failed = false;
      const failRenderer = (message: string) => {
        if (failed) return;
        failed = true;
        viewer.trackedEntity = undefined;
        viewer.useDefaultRenderLoop = false;
        if (metrics) {
          metrics.failed = true;
          metrics.ready = false;
        }
        setReady(false);
        latest.current.onUnavailable();
        latest.current.onError(message);
      };
      contextLost = () =>
        failRenderer(
          "WebGL context lost. Follow stopped; reload to restore the map. The traffic list remains available.",
        );
      viewer.scene.canvas.addEventListener("webglcontextlost", contextLost);
      viewer.scene.renderError.addEventListener((_scene, error) =>
        failRenderer(
          "3D rendering interrupted. Follow stopped. The traffic list remains available. " +
            String(error).slice(0, 100),
        ),
      );
      if (metrics) {
        metrics.ready = true;
        viewer.scene.postRender.addEventListener(() => {
          if (metrics.failed) return;
          const now = performance.now();
          metrics.lastRender = now;
          if (metrics.frames.length < 60000) metrics.frames.push(now);
          metrics.aircraftCount = layer.current?.entities.size ?? 0;
          const rect = viewer.camera.computeViewRectangle();
          metrics.visibleCount = rect
            ? latest.current.tracks.filter((t) => {
                const x = CMath.toRadians(t.latest.lon),
                  y = CMath.toRadians(t.latest.lat);
                return (
                  x >= rect.west &&
                  x <= rect.east &&
                  y >= rect.south &&
                  y <= rect.north
                );
              }).length
            : 0;
        });
      }
      viewer.camera.moveEnd.addEventListener(() => {
        const rectangle = viewer.camera.computeViewRectangle();
        if (!rectangle) return;
        latest.current.onVisibleCount(
          latest.current.tracks.filter((t) => {
            const x = CMath.toRadians(t.latest.lon),
              y = CMath.toRadians(t.latest.lat);
            return (
              x >= rectangle.west &&
              x <= rectangle.east &&
              y >= rectangle.south &&
              y <= rectangle.north
            );
          }).length,
        );
      });
      setReady(true);
      latest.current.onReady();
    } catch (e) {
      if (metrics) {
        metrics.failed = true;
        metrics.ready = false;
      }
      latest.current.onUnavailable();
      container.current?.replaceChildren();
      latest.current.onError(
        "WebGL is unavailable. You can still search and inspect aircraft in the traffic list.",
      );
      return;
    }
    return () => {
      modelAbort.abort();
      if (contextLost)
        viewer.scene.canvas.removeEventListener(
          "webglcontextlost",
          contextLost,
        );
      if (metrics) metrics.ready = false;
      handler?.destroy();
      layer.current?.clear();
      layer.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !props.airport || !ready) return;
    const entities = addAirport(v, props.airport);
    return () => {
      if (!v.isDestroyed()) entities.forEach((e) => v.entities.remove(e));
    };
  }, [props.airport, ready]);
  useEffect(() => {
    if (ready) {
      layer.current?.update(props.tracks, props.selected, props.trails);
      const rect = viewerRef.current?.camera.computeViewRectangle();
      if (rect)
        props.onVisibleCount(
          props.tracks.filter((t) => {
            const x = CMath.toRadians(t.latest.lon),
              y = CMath.toRadians(t.latest.lat);
            return (
              x >= rect.west &&
              x <= rect.east &&
              y >= rect.south &&
              y <= rect.north
            );
          }).length,
        );
    }
  }, [props.tracks, props.selected, props.trails, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.trackedEntity =
      props.follow && props.selected
        ? layer.current?.entities.get(props.selected)
        : undefined;
  }, [props.follow, props.selected, props.tracks, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.imageryLayers.get(0).show = props.night;
    v.imageryLayers.get(1).show = !props.night;
    v.clock.currentTime = JulianDate.fromIso8601(
      props.night ? "2026-11-19T16:00:00Z" : "2026-11-19T04:00:00Z",
    );
  }, [props.night, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.entities.values.forEach((e) => {
      if (
        !layer.current?.entities.has(e.id) &&
        e.id !== "selected-display-segment"
      )
        e.show = props.geometry;
    });
  }, [props.geometry, props.airport, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.trackedEntity = undefined;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        103.96,
        props.view === "3d" ? 1.08 : 1.36,
        props.view === "3d" ? 43000 : 125000,
      ),
      orientation: {
        heading: 0,
        pitch: props.view === "3d" ? CMath.toRadians(-48) : -Math.PI / 2,
        roll: 0,
      },
      duration: reduced ? 0 : 1.1,
    });
  }, [props.view, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    const { kind, id } = props.action;
    v.trackedEntity = undefined;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 0.8;
    if (kind === "in") {
      v.camera.zoomIn(v.camera.positionCartographic.height * 0.35);
      return;
    }
    if (kind === "out") {
      v.camera.zoomOut(v.camera.positionCartographic.height * 0.5);
      return;
    }
    if (kind === "north") {
      v.camera.setView({
        orientation: { heading: 0, pitch: v.camera.pitch, roll: 0 },
      });
      return;
    }
    if (kind === "runway") {
      const f = props.airport?.runways.features.find(
        (r) => r.properties.name === id,
      );
      if (f) {
        const a = f.geometry.coordinates[0];
        v.camera.flyTo({
          destination: Cartesian3.fromDegrees(a[0] - 0.025, a[1] - 0.04, 3500),
          orientation: {
            heading: CMath.toRadians(f.properties.bearing),
            pitch: CMath.toRadians(-35),
            roll: 0,
          },
          duration,
        });
      }
      return;
    }
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(103.96, 1.36, 125000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      duration,
    });
  }, [props.action, ready]);
  return (
    <div
      className="map-canvas"
      ref={container}
      aria-label="Singapore geographic flight map"
      role="region"
    />
  );
}
