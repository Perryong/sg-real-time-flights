import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Viewer,
  Rectangle,
  Cartesian3,
  Cartesian2,
  Matrix4,
  Transforms,
  SkyAtmosphere,
  Credit,
  Cartographic,
  LabelStyle,
  Color,
  UrlTemplateImageryProvider,
  ImageryLayer,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  HeadingPitchRange,
  Math as CMath,
  EllipsoidTerrainProvider,
  EllipsoidalOccluder,
  JulianDate,
} from "cesium";
import {nearbyAircraft,type ObserverPin} from "../data/observer";
import type {SkyAim} from "../components/ObserverPanel";
import type { Airport, Track } from "../data/types";
import { addAirport } from "./airport";
import { AircraftLayer } from "./aircraft";
import {type FollowCamera} from "../data/follow";
import type {FollowStyle} from "../components/FollowPanel";
import { guardCameraDoubleClick } from "./cameraGuard";
import type {} from "./performance";
import {modelFiles} from "../data/aircraftModels";
import {addFollowEnvironment,satelliteBackdrop} from "./environment";
import { DarkMapProvider } from "./imagery";
import {addRegionalWindLayer,createRadarLayerController} from "./weather";
import type {WindPoint,RadarFrame} from "../data/weather";
// Fit geographic bounds through Cesium's camera API so the shorter screen
// dimension contains the region in both widescreen and portrait layouts.
interface Region {lat:number;lon:number;radius:number;name:string}
function regionExtent(region:Region){
 const latSpan=region.radius/111.195*1.08,lonSpan=latSpan/Math.cos(region.lat*Math.PI/180);
 return Rectangle.fromDegrees(region.lon-lonSpan,region.lat-latSpan,region.lon+lonSpan,region.lat+latSpan);
}
export type CameraAction = (
  | { kind: "overview" | "north" | "in" | "out" | "runway" | "pin" | "place"; id?: string }
  | { kind: "locate"; id: string }
) & { nonce: number };

function locateAircraft(viewer: Viewer, position: Cartesian3) {
  const { camera, scene } = viewer;
  const canvas = scene.canvas;
  const bounds = canvas.getBoundingClientRect();
  camera.cancelFlight();
  const projected = SceneTransforms.worldToWindowCoordinates(scene, position);
  const globe = new EllipsoidalOccluder(scene.globe.ellipsoid, camera.positionWC);
  const markerOffsets = [[0, 0], [-24, -15], [24, -15], [-24, 30], [24, 30]];
  const markerFits = (x: number, y: number) => markerOffsets.every(([dx, dy]) =>
    document.elementFromPoint(x + dx, y + dy) === canvas,
  );
  if (projected && globe.isPointVisible(position) && markerFits(bounds.left + projected.x, bounds.top + projected.y)) return;

  const workspace = canvas.closest(".workspace");
  const panel = (selector: string) => workspace?.querySelector(selector)?.getBoundingClientRect();
  const details = panel(".details-panel");
  const narrow = matchMedia("(max-width: 800px)").matches;
  const left = narrow ? bounds.left : panel(".traffic-panel")?.right ?? bounds.left;
  let right = narrow ? panel(".map-controls")?.left ?? bounds.right : details?.left ?? bounds.right;
  const bottom = narrow ? details?.top ?? bounds.bottom : bounds.bottom;
  const weather = narrow ? panel(".weather-controls") : undefined;
  const top = Math.min(weather?.bottom ?? bounds.top, bottom - 60);
  // If the marker cannot fit below Weather, place it to the left of Weather.
  if (weather && top < weather.bottom) right = Math.min(right, weather.left);
  const focus = new Cartesian2((left + right) / 2, (top + bottom) / 2);
  if (!markerFits(focus.x, focus.y)) {
    // The open outlook and radar replay can cover the middle of the map.
    const fractions = [0.5, 0.25, 0.75, 0.125, 0.875];
    for (const row of fractions) {
      const y = top + row * (bottom - top);
      const x = fractions.map(column => left + column * (right - left)).find(x => markerFits(x, y));
      if (x !== undefined) {
        focus.x = x;
        focus.y = y;
        break;
      }
    }
  }
  focus.x -= bounds.left;
  focus.y -= bounds.top;

  const pitch = Math.min(camera.pitch, CMath.toRadians(-35));
  const altitude = Cartographic.fromCartesian(position).height;
  const range = Math.max(3000, camera.positionCartographic.height - altitude) / -Math.sin(pitch);
  camera.lookAt(position, new HeadingPitchRange(camera.heading, pitch, range));
  camera.lookAtTransform(Matrix4.IDENTITY);

  // Translate the camera so the aircraft projects into the gap between panels.
  const ray = camera.getPickRay(focus);
  if (!ray) return;
  const depth = range / Cartesian3.dot(ray.direction, camera.directionWC);
  const offset = Cartesian3.multiplyByScalar(ray.direction, depth, new Cartesian3());
  Cartesian3.subtract(position, offset, camera.position);
}
interface Props {
  windPoints:WindPoint[]|null;
  radarFrame:RadarFrame|null;
  radarOpacity:number;
  onRadarError:()=>void;
  onRadarReady:(at:number|null)=>void;
  region:Region;
  followCamera:FollowCamera;
  onFollowOrbit:(orbitDelta:number,elevationDelta:number)=>void;
  followStyle:FollowStyle;
  onSatelliteUnavailable:()=>void;
  observer:ObserverPin|null;
  placing:boolean;
  skyAim:SkyAim;
  onPin:(pin:ObserverPin)=>void;
  airport: Airport | null;
  tracks: Track[];
  selected: string | null;
  follow: boolean;
  night: boolean;
  view: "overhead" | "3d" | "sky";
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
  const regionalExtent=regionExtent(props.region);
  const container = useRef<HTMLDivElement>(null),
    viewerRef = useRef<Viewer | null>(null),
    layer = useRef<AircraftLayer | null>(null),
    latest = useRef(props),
    [ready, setReady] = useState(false);
  const radarLayer=useRef<ReturnType<typeof createRadarLayerController>|null>(null);
  const windLayer=useRef<ReturnType<typeof addRegionalWindLayer>|null>(null);
  const radarVisible=props.radarFrame!==null;
  const orbitPointer = useRef<{ id: number; anchorX: number; anchorY: number } | null>(null);
  // Cesium can interpret a drag that returns to its starting point as a click.
  const suppressSelection = useRef(false);
  const [reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  latest.current = props;

  function startOrbit(event: PointerEvent<HTMLDivElement>) {
    const canvas = viewerRef.current?.scene.canvas;
    if (!event.isPrimary || event.button !== 0 || !canvas || event.target !== canvas) return;
    if (orbitPointer.current && orbitPointer.current.id !== event.pointerId) return;
    suppressSelection.current = false;
    if (!props.follow || !props.selected) return;
    orbitPointer.current = { id: event.pointerId, anchorX: event.clientX, anchorY: event.clientY };
  }

  function moveOrbit(event: PointerEvent<HTMLDivElement>) {
    const pointer = orbitPointer.current;
    if (pointer?.id !== event.pointerId || !props.follow) return;
    const x = event.clientX - pointer.anchorX;
    const y = event.clientY - pointer.anchorY;
    if (!suppressSelection.current && Math.hypot(x, y) < 5) return;
    suppressSelection.current = true;
    const degreesPerPixel = 0.5;
    const orbit = Math.trunc(x * degreesPerPixel);
    const elevation = Math.trunc(y * degreesPerPixel);
    pointer.anchorX += orbit / degreesPerPixel;
    pointer.anchorY += elevation / degreesPerPixel;
    if (orbit || elevation) props.onFollowOrbit(orbit, elevation);
  }

  function cancelOrbit() {
    if (!orbitPointer.current) return;
    orbitPointer.current = null;
    suppressSelection.current = true;
  }

  function endOrbit(event: PointerEvent<HTMLDivElement>) {
    if (orbitPointer.current?.id !== event.pointerId) return;
    if (event.type !== "pointerup") {
      cancelOrbit();
      const canvas = viewerRef.current?.scene.canvas;
      if (event.type === "pointercancel" && canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (event.button !== 0) return;
    moveOrbit(event);
    orbitPointer.current = null;
  }

  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>setReducedMotion(media.matches);
    media.addEventListener('change',change);
    return ()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    const viewer=viewerRef.current;
    if(!ready||!viewer||viewer.isDestroyed()||!props.windPoints)return;
    const wind=addRegionalWindLayer(viewer,props.windPoints,reducedMotion);
    windLayer.current=wind;
    return()=>{wind.destroy();windLayer.current=null;};
  },[ready,props.windPoints,reducedMotion]);
  useEffect(()=>{
    windLayer.current?.setRadarVisible(radarVisible);
  },[ready,props.windPoints,reducedMotion,radarVisible]);
  useEffect(()=>{
    const viewer=viewerRef.current;
    if(!ready||!viewer||viewer.isDestroyed())return;
    const controller=createRadarLayerController(viewer);radarLayer.current=controller;
    return()=>{controller.destroy();radarLayer.current=null};
  },[ready]);
  useEffect(()=>{
    radarLayer.current?.show(props.radarFrame,props.radarOpacity,props.onRadarReady,props.onRadarError);
  },[ready,props.radarFrame,props.radarOpacity,props.onRadarReady,props.onRadarError]);
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
        skyAtmosphere: new SkyAtmosphere(),
        requestRenderMode: false,
      });
      viewerRef.current = viewer;
      guardCameraDoubleClick(viewer.screenSpaceEventHandler,()=>latest.current.view==='sky'||latest.current.placing||latest.current.follow);
      viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5);
      viewer.scene.postProcessStages.fxaa.enabled=true;
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
      const satellite=new UrlTemplateImageryProvider({
        url:satelliteBackdrop.url,maximumLevel:13,
        credit:new Credit(satelliteBackdrop.credit,true),
      });
      satellite.errorEvent.addEventListener(()=>{
        if(latest.current.follow&&latest.current.followStyle==='satellite'){
          latest.current.onSatelliteUnavailable();
          latest.current.onError('Satellite imagery unavailable; showing the day map.');
        }
      });
      viewer.imageryLayers.add(new ImageryLayer(satellite,{show:false}));
      viewer.camera.setView({
        destination: regionalExtent,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      layer.current = new AircraftLayer(viewer, () => latest.current.getNow(),message=>latest.current.onError(message));
      modelFiles.forEach(file=>fetch(`${import.meta.env.BASE_URL}models/${file}`, { signal: modelAbort.signal })
        .then(async (r) => {
          if (!r.ok) throw Error();
          const bytes = await r.arrayBuffer();
          if (new DataView(bytes).getUint32(0, true) !== 0x46546c67)
            throw Error();
        })
        .catch(() => {
          if (!modelAbort.signal.aborted) {
            layer.current?.modelUnavailable(file);
          }
        }));
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: any }) => {
        if (suppressSelection.current) return;
        if(latest.current.placing){
          const point=viewer.camera.pickEllipsoid(click.position,viewer.scene.globe.ellipsoid);
          if(point){const c=Cartographic.fromCartesian(point);latest.current.onPin({lat:CMath.toDegrees(c.latitude),lon:CMath.toDegrees(c.longitude),height:2})}
          return;
        }
        const picked = viewer.scene.pick(click.position);
        if (picked?.id?.id && layer.current?.tracks.has(picked.id.id))
          latest.current.onSelect(picked.id.id);
      }, ScreenSpaceEventType.LEFT_CLICK);
      let failed = false;
      const failRenderer = (message: string) => {
        if (failed) return;
        failed = true;
        cancelOrbit();
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
          const frame = layer.current?.followFrame;
          if (latest.current.follow && frame) {
            const origin = Cartesian3.fromDegrees(frame.lon, frame.lat, frame.placementAltitude);
            const local = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(origin), new Matrix4());
            const offset = Matrix4.multiplyByPoint(local, viewer.camera.positionWC, new Cartesian3());
            metrics.followOffset = { east: offset.x, north: offset.y, up: offset.z };
          } else {
            delete metrics.followOffset;
          }
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
      const sceneTracks=props.view==='sky'&&props.observer
        ? nearbyAircraft(props.observer,props.tracks,props.getNow()).filter(t=>t.elevation!==null&&t.elevation>=0).map(t=>t.track) : props.tracks;
      layer.current?.update(sceneTracks, props.selected, props.trails, props.view==='sky',props.follow?props.selected:null);
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
  }, [props.tracks, props.selected, props.trails, props.view, props.observer, props.follow, ready]);
  useEffect(()=>{
    const v=viewerRef.current;if(!v||!ready||!props.follow||!props.selected)return;
    const frustum=v.camera.frustum;
    const priorFov="fov" in frustum?frustum.fov:null;
    if("fov" in frustum)frustum.fov=CMath.toRadians(45);
    const prior={destination:Cartesian3.clone(v.camera.positionWC),orientation:{direction:Cartesian3.clone(v.camera.directionWC),up:Cartesian3.clone(v.camera.upWC)}};
    v.camera.cancelFlight();v.trackedEntity=undefined;
    v.scene.screenSpaceCameraController.enableInputs=false;
    const update=()=>{
      const p=latest.current,t=p.tracks.find(t=>t.id===p.selected),l=layer.current;
      if(!t||!l)return;
      l.displayed(t);
      const frame=l.followFrame;if(!frame)return;
      const {distance,orbit,elevation}=p.followCamera,azimuth=CMath.toRadians((frame.heading??0)+180+orbit),tilt=CMath.toRadians(elevation);
      const offset=new Cartesian3(Math.sin(azimuth)*distance*Math.cos(tilt),Math.cos(azimuth)*distance*Math.cos(tilt),distance*Math.sin(tilt));
      v.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(frame.lon,frame.lat,frame.placementAltitude)),offset);
    };
    const remove=v.scene.preRender.addEventListener(update);update();
    return ()=>{cancelOrbit();remove();if(v.isDestroyed())return;v.camera.lookAtTransform(Matrix4.IDENTITY);v.camera.setView(prior);if(priorFov!==null&&"fov" in frustum)frustum.fov=priorFov;v.scene.screenSpaceCameraController.enableInputs=true;};
  },[props.follow,props.selected,ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    const night=props.follow?props.followStyle==='night':props.night;
    v.imageryLayers.get(0).show = night;
    const satellite=props.follow&&props.followStyle==='satellite';
    v.imageryLayers.get(1).show = !night&&!satellite;
    v.imageryLayers.get(2).show = satellite;
    v.scene.skyAtmosphere!.show=props.follow;
    v.scene.globe.showGroundAtmosphere=props.follow;
    v.scene.backgroundColor=Color.fromCssColorString(props.follow&&!night?'#9ebdcb':'#08141e');
    v.clock.currentTime = JulianDate.fromIso8601(
      night ? "2026-11-19T16:00:00Z" : "2026-11-19T04:00:00Z",
    );
  }, [props.night, props.follow, props.followStyle, ready]);
  useEffect(()=>{
    const v=viewerRef.current;if(!v||!ready||!props.follow||props.followStyle==='night')return;
    return addFollowEnvironment(v,props.region.lat,props.region.lon,()=>latest.current.onError('Sky backdrop unavailable; using the atmosphere.'));
  },[props.follow,props.followStyle,props.region,ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.entities.values.forEach((e) => {
      if (
        !layer.current?.entities.has(e.id) &&
        e.id !== "selected-display-segment" && e.id !== "observer-pin"
      )
        e.show = props.geometry&&!props.follow;
    });
  }, [props.geometry, props.airport, props.follow, ready]);
  useEffect(()=>{
    const v=viewerRef.current;if(!v||!ready)return;
    v.entities.removeById('observer-pin');
    if(props.observer)v.entities.add({id:'observer-pin',position:Cartesian3.fromDegrees(props.observer.lon,props.observer.lat,2),
      point:{pixelSize:13,color:Color.CYAN,outlineColor:Color.BLACK,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},
      label:{text:'Your pin',font:'14px sans-serif',fillColor:Color.CYAN,style:LabelStyle.FILL_AND_OUTLINE,outlineWidth:3,pixelOffset:new Cartesian2(0,-24),disableDepthTestDistance:Number.POSITIVE_INFINITY}});
  },[props.observer,ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.trackedEntity = undefined;
    if(props.view==='sky'||props.follow)return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    v.camera.flyTo({
      destination: props.view === "3d"
        ? Cartesian3.fromDegrees(props.region.lon, props.region.lat - 0.28 * props.region.radius/46.3, 43000 * props.region.radius/46.3)
        : regionalExtent,
      orientation: {
        heading: 0,
        pitch: props.view === "3d" ? CMath.toRadians(-48) : -Math.PI / 2,
        roll: 0,
      },
      duration: reduced ? 0 : 1.1,
    });
  }, [props.view, props.region, ready]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    const { kind, id } = props.action;
    v.trackedEntity = undefined;
    if (kind === "locate") {
      const aircraft = layer.current;
      const track = aircraft?.tracks.get(id);
      if (aircraft && track && props.selected === id && !props.follow) {
        locateAircraft(v, aircraft.position(track));
      }
      return;
    }
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
    if(kind==='place'){
      v.camera.flyTo({destination:Rectangle.fromDegrees(103.59,1.15,104.11,1.48),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration});return;
    }
    if(kind==='pin'&&props.observer){
      v.camera.flyTo({destination:Cartesian3.fromDegrees(props.observer.lon,props.observer.lat,15000),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration});return;
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
      destination: regionalExtent,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      duration,
    });
  }, [props.action, ready]);
  useEffect(()=>{
    const v=viewerRef.current;if(!v||!ready)return;
    const sky=props.view==='sky'&&!!props.observer;
    v.scene.screenSpaceCameraController.enableInputs=!sky&&!props.follow;
    v.scene.screenSpaceCameraController.enableCollisionDetection=!sky;
    v.scene.screenSpaceCameraController.minimumZoomDistance=sky?2:200;
    if(sky&&props.observer){
      v.camera.cancelFlight();v.trackedEntity=undefined;
      v.camera.setView({destination:Cartesian3.fromDegrees(props.observer.lon,props.observer.lat,props.observer.height),
        orientation:{heading:CMath.toRadians(props.skyAim.heading),pitch:CMath.toRadians(props.skyAim.pitch),roll:0}});
    }
  },[props.view,props.observer,props.skyAim,props.follow,ready]);
  return (
    <div
      className={`map-canvas ${props.placing?'placing-pin':''}`}
      ref={container}
      aria-label={`${props.region.name} geographic flight map`}
      role="region"
      onPointerDownCapture={startOrbit}
      onPointerMoveCapture={moveOrbit}
      onPointerUpCapture={endOrbit}
      onPointerCancelCapture={endOrbit}
      onLostPointerCapture={endOrbit}
    />
  );
}
