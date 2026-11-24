import {
  Cartesian3,
  Color,
  CallbackProperty,
  CallbackPositionProperty,
  Transforms,
  HeadingPitchRoll,
  Math as CMath,
  DistanceDisplayCondition,
  NearFarScalar,
  Cartesian2,
  LabelStyle,
  Viewer,
  Entity,
  ConstantProperty,
  PointPrimitiveCollection,
  PolylineDashMaterialProperty,
  PolylineGraphics,
  PolylineGlowMaterialProperty,
} from "cesium";
import {followSample,type FollowSample} from "../data/follow";
import {aircraftModel} from "../data/aircraftModels";
import { displayPosition } from "../data/display";
import { freshness } from "../data/freshness";
import type { Track } from "../data/types";
const plane = (color: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><path d="M20 5Q22 0 24 5L25 16 40 26 40 30 25 25 25 34 30 38 30 41 22 38 14 41 14 38 19 34 19 25 4 30 4 26 19 16Z" fill="${color}" stroke="#101c22" stroke-width="1.2"/></svg>`,
  );
const amber = plane("#ebc474"),
  lime = plane("#c5f68c");
export class AircraftLayer {
  entities = new Map<string, Entity>();
  tracks = new Map<string, Track>();
  selected: string | null = null;
  trails = true;
  models = true;
  unavailableModels = new Set<string>();
  observerView = false;
  followId: string | null = null;
  followFrame: FollowSample | null = null;
  points: PointPrimitiveCollection;
  segment: Entity;
  constructor(
    private viewer: Viewer,
    private now: () => number,
  ) {
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.segment = viewer.entities.add({
      id: "selected-display-segment",
      polyline: {
        positions: new CallbackProperty(() => {
          const t = this.selected ? this.tracks.get(this.selected) : null;
          if (!t) return [];
          const p = t.history
            .filter(
              (o) =>
                o.position_time !== null && o.position_time <= (this.followFrame?.renderTime ?? this.now() - 10),
            )
            .at(-1);
          return p
            ? [
                Cartesian3.fromDegrees(
                  p.lon,
                  p.lat,
                  Math.max(5, p.alt_geom_m ?? p.alt_baro_m ?? 0),
                ),
                this.position(t),
              ]
            : [];
        }, false),
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: Color.fromCssColorString("#d9efb2"),
          dashLength: 8,
        }),
        show: new CallbackProperty(() => this.trails && !!this.selected && !this.followId, false),
      },
    });
  }
  displayed(t: Track) {
    if(t.id===this.followId){
      const sample=followSample(t,this.now());
      if(sample)this.followFrame=sample;
      if(this.followFrame)return this.followFrame;
    }
    if (!this.observerView) return displayPosition(t, this.now() - 10, this.now());
    const o = t.latest;
    return {lat:o.lat,lon:o.lon,ground:o.ground,
      altitude:Number.isFinite(o.alt_geom_m)?o.alt_geom_m:Number.isFinite(o.alt_baro_m)?o.alt_baro_m:null};
  }
  position(t: Track) {
    const p = this.displayed(t);
    return Cartesian3.fromDegrees(
      p.lon,
      p.lat,
      t.id===this.followId&&this.followFrame?this.followFrame.placementAltitude:p.ground === true ? 5 : Math.max(5, p.altitude ?? 0),
    );
  }
  update(tracks: Track[], selected: string | null, trails: boolean, observerView = false, followId:string|null = null) {
    if(this.followId!==followId)this.followFrame=null;
    this.followId=followId;
    this.observerView = observerView;
    trails = trails && !observerView;
    this.selected = selected;
    this.trails = trails;
    this.tracks = new Map(tracks.map((t) => [t.id, t]));
    this.points.removeAll();
    const chosen = selected ? this.tracks.get(selected) : null;
    if (trails && chosen && !followId)
      for (const o of chosen.history) {
        if (o.position_time !== null && o.position_time <= (this.followFrame?.renderTime ?? this.now() - 10) && (this.followId!==chosen.id || Number.isFinite(o.alt_geom_m??o.alt_baro_m)))
          this.points.add({
            position: Cartesian3.fromDegrees(
              o.lon,
              o.lat,
              Math.max(5, o.alt_geom_m ?? o.alt_baro_m ?? 0),
            ),
            pixelSize: 3,
            color: Color.fromCssColorString("#cee9a8"),
          });
      }
    for (const [id, e] of this.entities)
      if (!this.tracks.has(id)) {
        this.viewer.entities.remove(e);
        this.entities.delete(id);
      }
    for (const t of tracks) {
      let e = this.entities.get(t.id);
      if (!e) {
        const id = t.id;
        const current = () => this.tracks.get(id) ?? t;
        e = this.viewer.entities.add({
          id,
          name: t.latest.callsign ?? t.latest.provider_id,
          viewFrom: new ConstantProperty(new Cartesian3(-850, -850, 600)),
          position: new CallbackPositionProperty(
            () => this.position(current()),
            false,
          ),
          orientation: new CallbackProperty(
            () =>
              Transforms.headingPitchRollQuaternion(
                this.position(current()),
                new HeadingPitchRoll(
                  CMath.toRadians((id===this.followId&&this.followFrame ? this.followFrame.heading??0 : current().latest.heading_deg??current().latest.track_deg??0) - 90),
                  0,
                  0,
                ),
              ),
            false,
          ),
          billboard: {
            show:new CallbackProperty(()=>!this.followId||(id===this.followId&&!this.models),false),
            image: amber,
            width: 29,
            height: 29,
            rotation: new CallbackProperty(
              () => -CMath.toRadians(current().latest.track_deg ?? 0),
              false,
            ),
            alignedAxis: Cartesian3.UNIT_Z,
            color: new CallbackProperty(
              () =>
                Color.WHITE.withAlpha(
                  ["stale", "unknown"].includes(
                    freshness(current().latest.position_time, this.now()),
                  )
                    ? 0.45
                    : 1,
                ),
              false,
            ),
            scaleByDistance: new NearFarScalar(10000, 1.2, 300000, 0.75),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          model: {
            uri: new CallbackProperty(()=>{
              const file=aircraftModel(current().latest.aircraft_type).file;
              return `${import.meta.env.BASE_URL}models/${this.unavailableModels.has(file)?'generic-aircraft.glb':file}`;
            },false),
            minimumPixelSize: new CallbackProperty(()=>id===this.followId?96:24,false),
            maximumScale: 100,
            imageBasedLightingFactor:new Cartesian2(1,.6),
            scale: 1,
            show: new CallbackProperty(() => {
              const displayed = this.displayed(current());
              return (
                this.models &&
                (displayed.altitude !== null || displayed.ground === true) &&
                (id===this.followId || this.viewer.camera.positionCartographic.height < 12000)
              );
            }, false),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 15000),
          },
          label: {
            text: t.latest.callsign ?? t.latest.provider_id,
            font: "600 11px sans-serif",
            fillColor: Color.fromCssColorString("#e6e9e3"),
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.fromCssColorString("#081119"),
            outlineWidth: 4,
            pixelOffset: new Cartesian2(0, 24),
            show: new CallbackProperty(
              () =>
                !this.followId && (id === this.selected ||
                this.viewer.camera.positionCartographic.height < 70000),
              false,
            ),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        this.entities.set(id, e);
      }
      if (t.id === selected && trails) {
        const positions = t.history
          .filter(
            (o) =>
              o.position_time !== null &&
              o.position_time <= (this.followFrame?.renderTime ?? this.now() - 10) &&
              o.session_id === t.session_id && (this.followId!==t.id || Number.isFinite(o.alt_geom_m??o.alt_baro_m)),
          )
          .map((o) =>
            Cartesian3.fromDegrees(
              o.lon,
              o.lat,
              Math.max(5, o.alt_geom_m ?? o.alt_baro_m ?? 0),
            ),
          );
        if (!e.polyline)
          e.polyline = new PolylineGraphics({
            width: 2,
            material: Color.fromCssColorString("#9fce7a").withAlpha(0.65),
          });
        e.polyline.material=this.followId===t.id
          ?new PolylineGlowMaterialProperty({color:Color.fromCssColorString('#9969e8'),glowPower:.12})
          :new PolylineGlowMaterialProperty({color:Color.fromCssColorString('#9fce7a').withAlpha(.65),glowPower:0});
        e.polyline.width=new ConstantProperty(this.followId===t.id?3:2);
        e.polyline.positions = new ConstantProperty(positions);
      } else e.polyline = undefined;
      if (e.billboard)
        e.billboard.image = new ConstantProperty(
          t.id === selected ? lime : amber,
        );
    }
  }
  clear() {
    for (const e of this.entities.values()) this.viewer.entities.remove(e);
    this.entities.clear();
    this.tracks.clear();
    this.viewer.scene.primitives.remove(this.points);
    this.viewer.entities.remove(this.segment);
  }
}
