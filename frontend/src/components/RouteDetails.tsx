import type {Observation} from '../data/types';
import {changiIntent,intentLabel,routeFor} from '../data/routes';

export function OfficialBoards() {
  return <nav className="flight-board-links" aria-label="Official Changi flight boards">
    <span>Schedules & gates</span>
    <a href="https://www.changiairport.com/en/fly/flight-information/arrivals.html" target="_blank" rel="noreferrer" aria-label="Official Changi arrivals">Arrivals ↗</a>
    <a href="https://www.changiairport.com/en/fly/flight-information/departures.html" target="_blank" rel="noreferrer" aria-label="Official Changi departures">Departures ↗</a>
  </nav>;
}

export default function RouteDetails({observation:o,now,isChangi=true}:{observation:Observation;now:number;isChangi?:boolean}) {
  if(o.mode!=='live') return null;
  const route=routeFor(o,now),intent=isChangi?changiIntent(o,now):'unknown';
  return <section className="route-details" aria-label={isChangi?"Changi route estimate":"Usual route"}>
    {isChangi&&<strong className={`route-intent ${intent}`}>{intentLabel[intent]}</strong>}
    {route ? <>
      <h3>Usual route · {route.origin_iata??route.origin} → {route.destination_iata??route.destination}</h3>
      <p>FlyItalyADSB observed this route {route.observed_count} times, most recently on {route.last_seen_day} (UTC).</p>
      <p>{intent==='inbound' ? 'This route ends at Changi and the current course points toward it.' : intent==='outbound' ? 'This route starts at Changi and the current course points away from it.' : 'Changi direction is unknown.'} Today’s destination is unconfirmed.</p>
    </> : <p>No recent matching route evidence. Nearby traffic may serve other airports or pass through.</p>}
    {isChangi&&<OfficialBoards />}
  </section>;
}
