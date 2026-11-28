/** Fixed demo configuration. Change these constants to move the trip endpoints. */
export const START_NODE_ID = 'node/6046633874'; // 공릉역 (Gongneung) — BUS START POINT
export const DESTINATION_NODE_ID = 'node/5547152188'; // 서울과학기술대학교정문앞 — campus gate
export const ALT_STATION_NODE_ID = 'node/6041673026'; // 석계역 (Seokgye) — kept for swapping
/** Bus capacity. There is deliberately no stop-count cap; capacity is the only limit. */
export const BUS_CAPACITY = 20;
/**
 * Largest number of selected stops for which Held-Karp runs automatically.
 * n = selected stops (start and destination are excluded).
 *
 * Held-Karp costs O(n^2 * 2^n) time and O(n * 2^n) memory. The default keeps a
 * 15-stop solve inside a browser tab; larger n falls back to the heuristic.
 * The UI lets the user raise this limit explicitly after a warning.
 */
export const HELD_KARP_MAX_STOPS = 15;
/**
 * Absolute upper bound accepted by the UI. Raising HELD_KARP_MAX_STOPS above
 * this is refused because the DP arrays would exceed a typical browser tab.
 * (n = 20 needs roughly 168 MB for dp + 20 MB for parents.)
 */
export const HELD_KARP_HARD_LIMIT = 20;
/** Stops whose nearest drivable vertex is farther than this are not offered for selection. */
export const MAX_STOP_SNAP_METERS = 150;
/** Animation speed: metres of road travelled per real second at 1×. */
export const BASE_SIM_SPEED = 55;
/** Dwell time at each pickup stop, in milliseconds. */
export const STOP_DWELL_MS = 1400;
/** Default number of scenarios per k for the benchmark panel. */
export const DEFAULT_BENCHMARK_SCENARIOS = 200;
/** Default base seed for random scenarios and the benchmark. */
export const DEFAULT_SCENARIO_SEED = 20261127;
