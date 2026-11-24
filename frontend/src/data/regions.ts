export const regions={
 singapore:{name:'Singapore',lat:1.3644,lon:103.9915,radius:500},
 london:{name:'London',lat:51.47,lon:-0.4543,radius:200},
 tokyo:{name:'Tokyo',lat:35.5494,lon:139.7798,radius:200},
} as const;
export type RegionId=keyof typeof regions;
