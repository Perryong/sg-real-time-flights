// Maximum regional view. ADSB.fi covers the inner 100 NM; FlyItalyADSB covers 500 km.
export const COVERAGE_RADIUS_KM = 500;
export const COVERAGE_RADIUS_NM = COVERAGE_RADIUS_KM / 1.852;
export const REGION_SCALE = COVERAGE_RADIUS_NM / 25;
