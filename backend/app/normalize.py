import math
from .contracts import Mode, Observation

def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None

def text(value):
    return value.strip()[:100] or None if isinstance(value, str) else None

def normalize_record(raw: dict, provider_time: float | None, receipt_time: float, mode: Mode, contract: bool) -> Observation | None:
    if not isinstance(raw, dict):
        return None
    lat, lon, ident = number(raw.get('lat')), number(raw.get('lon')), text(raw.get('hex'))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180 or not ident:
        return None
    provider_time = number(provider_time)
    valid_clock = contract and provider_time is not None and 946684800 <= provider_time <= receipt_time
    def event_time(field):
        age = number(raw.get(field))
        return provider_time - age if valid_clock and age is not None and 0 <= age <= 86400 else None
    def scaled(field, multiplier=1):
        value = number(raw.get(field))
        return value * multiplier if value is not None else None
    def angle(field):
        value = number(raw.get(field))
        return value if value is not None and 0 <= value <= 360 else None
    position_time = event_time('seen_pos')
    provider = 'adsb.fi' if mode == 'live' else 'fixture'
    ident = ident.lower()
    # Whitelist raw fields; nonfinite JSON numbers cannot cross the wire.
    raw_values = {k: (v if not isinstance(v, float) or math.isfinite(v) else None) for k, v in raw.items()
                  if k in ('alt_baro','alt_geom','gs','track','true_heading','baro_rate','geom_rate','seen_pos','seen','type') and isinstance(v, (str,int,float,bool,type(None)))}
    return Observation(id=f'{mode}:{provider}:{ident}', provider=provider, provider_id=ident,
        session_id='initial', mode=mode, lat=lat, lon=lon,
        callsign=text(raw.get('flight')), registration=text(raw.get('r')), aircraft_type=text(raw.get('t')),
        alt_geom_m=scaled('alt_geom', .3048), alt_baro_m=scaled('alt_baro', .3048),
        ground=True if raw.get('alt_baro') == 'ground' else (False if number(raw.get('alt_baro')) is not None else None),
        speed_mps=scaled('gs', 1852/3600) if (number(raw.get('gs')) or 0) >= 0 else None,
        track_deg=angle('track'), heading_deg=angle('true_heading'),
        vertical_rate_mps=scaled('geom_rate', .00508) if number(raw.get('geom_rate')) is not None else scaled('baro_rate', .00508),
        position_time=position_time, provider_time=provider_time, receipt_time=receipt_time,
        message_time=event_time('seen'), timestamp_quality='derived' if position_time is not None else 'unknown',
        source_category=text(raw.get('type')), raw=raw_values,
        quality={k: raw[k] for k in ('nic','rc','nac_p','sil') if number(raw.get(k)) is not None})
