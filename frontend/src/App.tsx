import { COVERAGE_RADIUS_KM } from "./data/coverage";
import { airportUrl, assetUrl, liveAvailable, httpFeedUrl } from "./data/hosting";
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  Radar,
  MapPin,
  Map,
  Plane,
  Layers3,
  Info,
  Search,
  ChevronDown,
  Plus,
  Minus,
  Navigation,
  LocateFixed,
  Sun,
  Moon,
  Box,
  Globe2,
  Radio,
  Play,
  Pause,
  RotateCcw,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import type { CameraAction } from "./scene/MapScene";
const MapScene = lazy(() => import("./scene/MapScene"));
import FollowPanel,{type FollowStyle} from "./components/FollowPanel";
import {followSample,defaultFollowCamera} from "./data/follow";
import {regions,type RegionId} from "./data/regions";
import ObserverPanel, {type SkyAim} from "./components/ObserverPanel";
import {isSingaporePin,relativeAircraft,type ObserverPin} from "./data/observer";
import TrafficList from "./components/TrafficList";
import ProviderCredits from "./components/ProviderCredits";
import AircraftDetails, { formatTime } from "./components/AircraftDetails";
import SourceDetails from "./components/SourceDetails";
import { useTraffic } from "./hooks/useTraffic";
import { freshness, effectiveUpstreamState } from "./data/freshness";
import type { Airport, Mode, Track } from "./data/types";

export default function App() {
  const [region,setRegion]=useState<RegionId>("singapore");
  const feed = useTraffic(region);
  const activeRegion=regions[feed.mode==='live'?region:'singapore'];
  const [followCamera,setFollowCamera]=useState({...defaultFollowCamera});
  const [followStyle,setFollowStyle]=useState<FollowStyle>("satellite");
  const [airport, setAirport] = useState<Airport | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [follow, setFollow] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [night, setNight] = useState(true),
    [view, setView] = useState<"overhead" | "3d" | "sky">("overhead"),
    [trails, setTrails] = useState(true),
    [geometry, setGeometry] = useState(true),
    [layers, setLayers] = useState(false),
    [sources, setSources] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth >= 800),
    [mapReady, setMapReady] = useState(false),
    [mapError, setMapError] = useState<string | null>(null),
    [inView, setInView] = useState(0),
    [action, setAction] = useState<CameraAction>({
      kind: "overview",
      nonce: 0,
    });
  const [observer,setObserver]=useState<ObserverPin|null>(null);
  const [observerOpen,setObserverOpen]=useState(false),[placing,setPlacing]=useState(false);
  const [skyAim,setSkyAim]=useState<SkyAim>({heading:0,pitch:15});
  const placePin=(pin:ObserverPin)=>{
    if(!isSingaporePin(pin)){setMapError('Choose a point within the Singapore map area.');return}
    setObserver(pin);setPlacing(false);setObserverOpen(true);setSidebar(true);setFollow(false);setMapError(null);
  };
  const previousSelection = useRef<Track | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(airportUrl, { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setAirport)
      .catch(() => {
        if (!c.signal.aborted)
          setMapError(
            "Airport geometry unavailable. Refresh the page to try again.",
          );
      });
    return () => c.abort();
  }, []);
  const bucket = Math.floor(feed.now);
  const tracks = useMemo(
    () =>
      feed.snapshot?.tracks.filter(
        (t) => freshness(t.latest.position_time, feed.now) !== "lost",
      ) ?? [],
    [feed.snapshot, bucket],
  );
  const chosen = tracks.find((t) => t.id === selected);
  if (chosen) previousSelection.current = chosen;
  const lost = !!selected && !chosen;
  useEffect(() => {
    if (lost) setFollow(false);
  }, [lost]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacing(false);
        setFollow(false);
        setSources(false);
        setLayers(false);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            'input[aria-label="Search aircraft"]',
          )
          ?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const choose = (id: string) => {
    setSelected(id);
    setFollow(false);
    if(view==='sky')setView('overhead');
  };
  const switchMode = (mode: Mode) => {
    setSelected(null);
    previousSelection.current = null;
    setFollow(false);
    if(mode!=="live")setRegion("singapore");
    feed.setMode(mode);
  };
  const camera = (kind: CameraAction["kind"], id?: string) => {
    setFollow(false);
    if (kind === "overview" || kind === "place" || kind === "pin") setView("overhead");
    if (kind === "runway") {setRegion("singapore");setSelected(null);setView("3d");}
    setAction({ kind, id, nonce: Date.now() });
  };
  const reported = feed.snapshot?.status;
  const upstream = reported && feed.mode==='live'
    ? {...reported,upstream_state:effectiveUpstreamState(reported,feed.transport,feed.now)} : reported;
  const unavailable = !upstream || upstream.upstream_state === "unavailable";
  const lastAge =
    upstream?.newest_position_time != null
      ? Math.max(0, Math.floor(feed.now - upstream.newest_position_time))
      : null;
  return (
    <div
      className={`app ${night ? "night" : "day"} ${sidebar ? "sidebar-open" : "sidebar-closed"} ${follow?"following":""}`}
    >
      <header className="topbar">
        <a className="brand" href={assetUrl("")} aria-label="Changi Observatory home">
          <span className="brand-mark">
            <Radar size={25} />
          </span>
          <span>
            CHANGI<span className="brand-sub">OBSERVATORY</span>
          </span>
          <span className="version">BETA</span>
        </a>
        <div className="header-divider" />
        <div className="workspace-title">
          <Globe2 size={16} />
          <label className="region-picker"><span className="sr-only">Airspace region</span><select aria-label="Airspace region" value={region} disabled={feed.mode!=='live'||!httpFeedUrl||follow} onChange={e=>{setSelected(null);setFollow(false);setPlacing(false);setObserverOpen(false);setView("overhead");setRegion(e.target.value as RegionId)}}>{Object.entries(regions).map(([key,r])=><option key={key} value={key}>{r.name} airspace</option>)}</select></label>
        </div>
        <div className="header-right">
          <span
            className={`session-pill ${feed.mode === "live" ? "" : "demo"}`}
          >
            <span className="tiny-dot" />
            {feed.mode === "live"
              ? "LIVE FEED"
              : feed.mode === "simulated"
                ? "SIMULATED"
                : "RECORDED — NOT LIVE"}
          </span>
          <time>
            {formatTime(feed.now)}
            <small>
              {feed.mode === "live" ? "LOCAL TIME" : "SCENARIO TIME"}
            </small>
          </time>
          <button
            className="icon-button about"
            aria-label="Sources and accuracy"
            onClick={() => setSources(true)}
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <Suspense fallback={null}>
          <MapScene
            region={activeRegion}
            followCamera={followCamera}
            followStyle={followStyle}
            onSatelliteUnavailable={()=>setFollowStyle("day")}
            observer={observer}
            placing={placing}
            skyAim={skyAim}
            onPin={placePin}
            airport={airport}
            tracks={tracks}
            selected={selected}
            follow={follow}
            night={night}
            view={view}
            trails={trails}
            geometry={geometry}
            action={action}
            getNow={feed.getNow}
            onSelect={choose}
            onError={setMapError}
            onReady={() => setMapReady(true)}
            onUnavailable={() => {
              setMapReady(false);
              setFollow(false);
            }}
            onVisibleCount={setInView}
          />
        </Suspense>
        <div className="map-shade" />
        {!follow&&<select className="mobile-region-picker" aria-label="Map region" value={region} disabled={feed.mode!=='live'||!httpFeedUrl} onChange={e=>{setSelected(null);setFollow(false);setObserverOpen(false);setPlacing(false);setView('overhead');setRegion(e.target.value as RegionId)}}>{Object.entries(regions).map(([key,r])=><option key={key} value={key}>{r.name}</option>)}</select>}
        <nav className="rail" aria-label="Primary navigation">
          <button
            className={`rail-button ${sidebar && !observerOpen ? "active" : ""}`}
            aria-label="Toggle aircraft list"
            onClick={() => {setObserverOpen(false);setSidebar(observerOpen?true:!sidebar)}}
          >
            <Plane size={21} />
            <span>Traffic</span>
          </button>
          <button
            className="rail-button"
            aria-label="Changi airport overview"
            onClick={() => {
              camera("runway", airport?.runways.features[0]?.properties.name);
              setView("3d");
            }}
          >
            <Map size={20} />
            <span>Airport</span>
          </button>
          <button
            className={`rail-button ${layers ? "active" : ""}`}
            aria-label="Map layers"
            onClick={() => setLayers(!layers)}
          >
            <Layers3 size={20} />
            <span>Layers</span>
          </button>
          <button className={`rail-button ${observerOpen?'active':''}`} aria-label="My location" onClick={()=>{setRegion("singapore");setSelected(null);setFollow(false);setObserverOpen(true);setSidebar(true)}}><MapPin size={20}/><span>My spot</span></button>
          <div className="rail-bottom">
            <button
              className="rail-button"
              aria-label="About data sources"
              onClick={() => setSources(true)}
            >
              <Info size={20} />
              <span>About</span>
            </button>
            <span className="rail-coordinate">1.36° N</span>
          </div>
        </nav>
        <div className="left-panel-wrap">
          {sidebar && observerOpen && <ObserverPanel pin={observer} placing={placing} sky={view==='sky'} aim={skyAim} tracks={tracks} now={feed.now} mode={feed.mode} mapReady={mapReady}
            onPin={placePin} onPlace={()=>{setPlacing(true);setSidebar(false);camera('place')}} onCancel={()=>setPlacing(false)}
            onRemove={()=>{setObserver(null);setPlacing(false);if(view==='sky')setView('overhead')}} onCenter={()=>camera('pin')}
            onSky={()=>{setFollow(false);setView(view==='sky'?'overhead':'sky')}} onAim={setSkyAim}
            onLook={track=>{if(!observer)return;const target=relativeAircraft(observer,track.latest);if(target.elevation===null)return;choose(track.id);setSkyAim({heading:target.bearing,pitch:target.elevation});setView('sky')}}/>}
          {sidebar && !observerOpen && (
            <TrafficList
              radius={activeRegion.radius}
              regionName={activeRegion.name}
              isChangi={feed.mode!=='live'||region==='singapore'}
              movements={upstream?.movements}
              onDemand={upstream?.collection_mode === "on_demand"}
              connected={feed.transport === "connected"}
              sources={upstream?.sources}
              tracks={tracks}
              selected={selected}
              onSelect={choose}
              now={feed.now}
              mode={feed.mode}
              query={query}
              setQuery={setQuery}
              filter={filter}
              setFilter={setFilter}
              onDemo={() => switchMode("simulated")}
              unavailable={feed.mode === "live" && unavailable}
            />
          )}
          <button
            className="collapse-panel icon-button"
            aria-label={sidebar ? "Hide aircraft panel" : "Show aircraft panel"}
            onClick={() => setSidebar(!sidebar)}
          >
            {sidebar ? (
              <PanelLeftClose size={17} />
            ) : (
              <PanelLeftOpen size={17} />
            )}
          </button>
        </div>
        <div className="map-topline">
          <div className="map-breadcrumb">
            <span className="tiny-dot" />
            <span>{activeRegion.name==='Singapore'?'SINGAPORE':activeRegion.name==='London'?'UNITED KINGDOM':'JAPAN'}</span>
            <span className="slash">/</span>
            <strong>{activeRegion.name.toUpperCase()}</strong>
            <span className="region-badge">{activeRegion.radius} km</span>
          </div>
          <div className="mode-switch" aria-label="Data mode">
            <button
              className={feed.mode === "live" ? "active" : ""}
              onClick={() => switchMode("live")}
              disabled={!liveAvailable}
              title={liveAvailable ? "Live observations" : "This hosted demo has no live-data server connected"}
            >
              <Radio size={13} /> Live
            </button>
            <button
              className={feed.mode === "simulated" ? "active demo" : ""}
              onClick={() => switchMode("simulated")}
            >
              <Play size={12} /> Demo
            </button>
          </div>
        </div>
        {feed.mode !== "live" && (
          <div className="simulation-banner">
            <span className="tiny-dot" />
            <strong>
              {feed.mode === "simulated" ? "SIMULATED" : "RECORDED — NOT LIVE"}
            </strong>
            <span>Synthetic scenario · no real flights</span>
          </div>
        )}
        {placing&&<div className="pin-placement-banner" role="status">Tap the map to place your pin <button onClick={()=>{setPlacing(false);setSidebar(true)}}>Cancel</button></div>}
        {view==='sky'&&<div className="pin-placement-banner"><span>SKY VIEW FROM PIN</span><button onClick={()=>setView('overhead')}>Exit sky view</button></div>}
        {view!=='sky'&&<div className="map-controls">
          <div className="control-group">
            <button
              className="icon-button"
              aria-label="Reset north"
              onClick={() => camera("north")}
            >
              <Navigation size={19} />
              <small>N</small>
            </button>
          </div>
          <div className="control-group">
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => camera("in")}
            >
              <Plus size={20} />
            </button>
            <span className="control-rule" />
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => camera("out")}
            >
              <Minus size={20} />
            </button>
          </div>
          <div className="control-group">
            <button
              className="icon-button"
              aria-label="Regional overview"
              onClick={() => camera("overview")}
            >
              <LocateFixed size={19} />
            </button>
            <span className="control-rule" />
            <button
              className="icon-button"
              aria-label={night ? "Switch to day" : "Switch to night"}
              onClick={() => setNight(!night)}
            >
              {night ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
          <button
            className={`view-button ${view === "3d" ? "active" : ""}`}
            onClick={() => {
              setFollow(false);
              setView(view === "3d" ? "overhead" : "3d");
            }}
          >
            <Box size={16} />
            {view === "3d" ? "2D" : "3D"}
          </button>
        </div>}
        {layers && (
          <section
            className="layers-popover panel"
            aria-label="Map layers panel"
          >
            <div className="section-kicker">
              <span>MAP LAYERS</span>
              <button
                className="icon-button small"
                aria-label="Close layers"
                onClick={() => setLayers(false)}
              >
                <X size={15} />
              </button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={geometry}
                onChange={(e) => setGeometry(e.target.checked)}
              />{" "}
              Airport geometry
            </label>
            <label>
              <input
                type="checkbox"
                checked={trails}
                onChange={(e) => setTrails(e.target.checked)}
              />{" "}
              Selected aircraft trail
            </label>
            <span className="eyebrow">RUNWAY VIEWS</span>
            {airport?.runways.features.map((r) => (
              <button
                className="runway-button"
                key={r.properties.id}
                onClick={() => {
                  camera("runway", r.properties.name);
                  setLayers(false);
                }}
              >
                {r.properties.name}
                <ArrowUpRight size={14} />
              </button>
            ))}
            <p>Physical geometry only. Operational availability unknown.</p>
          </section>
        )}
        {chosen && !follow && view!=='sky' && (
          <AircraftDetails
            isChangi={activeRegion.name==='Singapore'}
            track={chosen}
            now={feed.now}
            follow={follow}
            followAvailable={mapReady&&followSample(chosen,feed.now)!==null}
            onFollow={() => {setPlacing(false);setLayers(false);setFollowCamera({...defaultFollowCamera});setFollow(true)}}
            onClose={() => {
              setSelected(null);
              setFollow(false);
            }}
          />
        )}
        {follow&&chosen&&<FollowPanel track={chosen} tracks={tracks} now={feed.now} mode={feed.mode} camera={followCamera} style={followStyle} trails={trails} onCamera={setFollowCamera} onStyle={setFollowStyle} onTrails={()=>setTrails(!trails)} onSelect={id=>{setFollowCamera({...defaultFollowCamera});setSelected(id)}} onExit={()=>setFollow(false)}/>}
        {lost && (
          <div className="lost-notice panel">
            <strong>
              Track lost ·{" "}
              {previousSelection.current?.latest.callsign ?? selected}
            </strong>
            <p>Last position is no longer current. Follow stopped.</p>
            <button onClick={() => setSelected(null)}>Dismiss</button>
          </div>
        )}
        {!mapReady && !mapError && (
          <div className="map-loading">
            <Radar size={28} />
            <span>Preparing Singapore airspace…</span>
          </div>
        )}
        {(mapError || feed.error) && (
          <div className="map-warning" role="status">
            <Info size={14} />
            {mapError ?? feed.error}
            <button
              aria-label="Dismiss map notice"
              onClick={() => setMapError(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className="map-bottom">
          <div className="map-stat panel">
            <span className="tiny-dot" />
            <div>
              <strong>{tracks.length}</strong>
              <span>
                {feed.mode === "live"
                  ? "AIRCRAFT TRACKED"
                  : "SYNTHETIC AIRCRAFT"}
              </span>
            </div>
            <span className="stat-divider" />
            {view!=='sky'&&<div>
              <strong>{Math.min(inView, tracks.length)}</strong>
              <span>IN VIEW</span>
            </div>}
            <span className="stat-icon">
              <Radar size={23} />
            </span>
          </div>
          <div className="presentation-label">
            {follow
              ? "FOLLOW CAMERA"
              : view === "sky" ? "OBSERVER SKY VIEW" : view === "3d"
                ? "3D GEOGRAPHIC VIEW"
                : "NORTH-UP GEOGRAPHIC VIEW"}
            <span>
              {night ? "Night" : "Day"} presentation · heights approximate
            </span>
          </div>
        </div>
        {feed.mode !== "live" && (
          <div className="playback-bar panel">
            <button
              className="icon-button"
              aria-label={feed.playing ? "Pause playback" : "Resume playback"}
              onClick={feed.togglePlay}
            >
              {feed.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              className="icon-button"
              aria-label="Restart playback"
              onClick={() => feed.seek(feed.start)}
            >
              <RotateCcw size={15} />
            </button>
            <input
              aria-label="Scenario timeline"
              type="range"
              min={feed.start}
              max={feed.end || 1}
              value={Math.min(feed.now, feed.end || 1)}
              onChange={(e) => feed.seek(Number(e.target.value))}
            />
            <span>
              {Math.max(0, Math.floor(feed.now - feed.start))} /{" "}
              {feed.end - feed.start}s
            </span>
            <b>1×</b>
          </div>
        )}
      </main>
      <footer className="statusbar">
        <div>
          {feed.mode === "live" && (
            <ProviderCredits sources={upstream?.sources} />
          )}
          <span
            className={`status-dot ${feed.mode !== "live" ? "demo" : upstream?.upstream_state === "healthy" ? "healthy" : "warning"}`}
          />
          <strong>
            {feed.mode !== "live"
              ? "SIMULATED · NOT LIVE"
              : unavailable
                ? "LIVE DATA UNAVAILABLE"
                : upstream?.upstream_state?.toUpperCase()}
          </strong>
          <span className="footer-divider" />
          <span>Transport: {feed.transport}</span>
          <span className="footer-divider" />
          <span>
            {feed.mode === "live" ? "Newest position" : "Scenario age"}:{" "}
            {lastAge === null ? "unknown" : `${lastAge}s`}
          </span>
        </div>
        <div>
          <span>{view==='sky'?'Latest observed positions':'Buffer 10s'}</span>
          <span className="footer-divider" />
          <button onClick={() => setSources(true)}>Sources & accuracy</button>
          <span className="footer-divider" />
          <span>Not for navigation</span>
        </div>
      </footer>
      {sources && (
        <SourceDetails
          isChangi={activeRegion.name==='Singapore'}
          airport={airport}
          status={upstream}
          transport={feed.transport}
          onClose={() => setSources(false)}
        />
      )}
    </div>
  );
}
