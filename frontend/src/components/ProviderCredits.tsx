import type { FeedStatus } from "../data/types";

export default function ProviderCredits({ sources }: { sources?: FeedStatus["sources"] }) {
  return <span className="provider-credits">
    <a href="https://adsb.fi/" target="_blank" rel="noreferrer">ADSB.fi</a>
    {sources?.flyitalyadsb?.enabled && <> + <a href="https://flyitalyadsb.com/" target="_blank" rel="noreferrer">FlyItalyADSB</a></>}
    {sources?.opensky?.enabled && <> + <a href="https://opensky-network.org/" target="_blank" rel="noreferrer">OpenSky</a></>}
  </span>;
}
