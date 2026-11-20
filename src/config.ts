/** Fixed demo configuration. Change these constants to move the trip endpoints. */
export const START_NODE_ID = 'node/6046633874'; // 공릉역 (Gongneung) — BUS START POINT
export const DESTINATION_NODE_ID = 'node/5547152188'; // 서울과학기술대학교정문앞 — campus gate
export const ALT_STATION_NODE_ID = 'node/6041673026'; // 석계역 (Seokgye) — kept for swapping
export const MAX_STOPS = 9;
export const BUS_CAPACITY = 20;
/** Stops whose nearest drivable vertex is farther than this are not offered for selection. */
export const MAX_STOP_SNAP_METERS = 150;
/** Animation speed: metres of road travelled per real second at 1×. */
export const BASE_SIM_SPEED = 55;
/** Dwell time at each pickup stop, in milliseconds. */
export const STOP_DWELL_MS = 1400;
