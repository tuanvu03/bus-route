# Campus Loop

A single-bus pickup route simulator for the area around Seoul National University of
Science and Technology (SNUST / 서울과학기술대학교) in Nowon-gu, Seoul.

Pick up to nine waiting bus stops, set how many passengers are waiting at each, and the app
solves the exact best visiting order on the real directed road graph. It then animates one
20-seat bus from Gongneung station, through every pickup, to the campus gate — and exposes
the full Dijkstra calculation, step by step, for teaching and inspection.

![Stack](https://img.shields.io/badge/React-19-0c6b58) ![Stack](https://img.shields.io/badge/TypeScript-strict-0c6b58) ![Stack](https://img.shields.io/badge/Vite-8-0c6b58) ![Tests](https://img.shields.io/badge/tests-25%20passing-0c6b58)

## Quick start

```bash
npm install
npm run dev          # builds public/graph.json, then starts Vite on http://127.0.0.1:5173
```

Other commands:

```bash
npm run build:graph  # export.geojson -> public/graph.json (also prints the data report)
npm run build        # rebuild graph, type-check, production bundle
npm test             # rebuild graph, then run the Vitest suite
npm run preview      # serve the production build
```

There is no backend. Everything — graph construction, Dijkstra, Held-Karp, snapping,
animation — runs in the browser (or in Node for the build/tests).

## What the app does

1. **Choose waiting stops.** Click dots on the map or rows in the left list. A stop can be
   removed by clicking it again. Each selected stop defaults to 1 passenger and can be
   edited between 1 and 20. At most 9 stops can be selected; the total must stay ≤ 20.
2. **Run the optimiser.** Dijkstra is run from every key point on the directed graph,
   producing an asymmetric distance matrix. Held-Karp DP then finds the exact best order
   from the start through all stops to the destination.
3. **Inspect the algorithm.** The right-hand **Dijkstra log** tab replays any directed leg
   between any two key points: settlement table, frontier snapshot, relaxed edges, shortest
   path, filters, pagination and map highlighting. The **Matrix** tab shows the full
   pairwise matrix and lets you click any cell to open that leg.
4. **Animate the trip.** Play / pause / reset, scrub the timeline, change speed. The bus
   pauses at each pickup, the onboard counter updates, and a completion summary shows total
   distance, the visiting order and passengers delivered.

The **Demo** button loads a six-stop, 16-passenger trip (7.40 km) so the full experience is
one click away.

## Project layout

```
export.geojson                  Source Overpass Turbo extract (committed)
scripts/
  build-graph.ts                GeoJSON -> public/graph.json preprocessing
  export-reference-pairs.ts     Export app distances for external verification
  verify-networkx.py            Optional networkx cross-check
public/graph.json               Generated, ready-to-load graph (≈692 KB)
src/
  config.ts                     Endpoints, capacity, stop-limit, snapping, sim speed
  lib/
    buildGraph.ts               Pure GeoJSON -> graph builder (also used by tests/script)
    types.ts                    Graph / stop / serialized types
    geo.ts                      Haversine, 7-decimal coordinate keys
    heap.ts                     Hand-written binary min-heap
    dijkstra.ts                 Dijkstra + settlement log + frontier replay
    heldKarp.ts                 Held-Karp DP + brute-force order enumeration
    route.ts                    Matrix, order, stitched geometry, animation lookup
    loadGraph.ts                Browser graph loader
    format.ts, labels.ts        Formatting and S/A–I/T key-point labels
  hooks/useSimulation.ts        requestAnimationFrame simulation state machine
  components/                   Map, sidebar, inspector tabs, simulation bar, legend
  App.tsx, styles.css
tests/                          Vitest unit + integration tests
NOTES.md                        Assumptions and data problems found
```

## Data pipeline

`scripts/build-graph.ts` reads `export.geojson`, calls the pure `buildGraph()` function and
writes `public/graph.json`. It prints a report every time it runs:

```
source features         1407
vertices (raw → main)   5161 → 5089
directed edges (raw → kept) 10723 → 10614 (109 outside main component)
drivable ways           1106 (3 non-drivable omitted)
weak components         5089, 23, 14, 14, 13, 3, 3, 2
main component          5089 vertices (8 components)
largest strong component 5008 vertices
one-way segments        829
selectable stops        291 (3 dropped as too far from a road)
start snap              공릉 → 2.8 m
destination snap        서울과학기술대학교정문앞 → 164.8 m
worst kept stop snap    84.5 m
```

### Building the graph

- **Coordinates are nodes.** GeoJSON has no OSM node IDs on road geometry, so intersections
  are created only when two LineStrings share the exact coordinate key
  `"lon,lat"` rounded to **7 decimals** (`src/lib/geo.ts:coordKey`). There is no geometric
  intersection or bridge-crossing magic.
- **Drivable ways:** `motorway, trunk, primary, secondary, tertiary, unclassified,
  residential, service`, excluding `service=parking_aisle` on any highway, `motor_vehicle=no` and
  `access=no`. Footways, paths, cycleways and steps are excluded.
- **Directions:** `oneway=yes/true/1` follows coordinate order; `oneway=-1/reverse` goes
  against it; no oneway tag is bidirectional; `junction=roundabout/circular` is one-way in
  coordinate order unless explicitly `oneway=no`. Parallel duplicate directed edges keep the
  shortest weight.
- **Weights:** Haversine distance in metres between consecutive coordinates.
  Earth radius used: `6_371_008.8 m`.
- **Main component:** only the largest *weakly* connected component is kept. All endpoints
  and offered stops are snapped to vertices in that component. Other components are
  reported and their edges dropped.
- **Map road layer:** the original drivable LineStrings are serialised separately (with
  `highway`, `name`, oneway/layer/bridge/tunnel flags) and drawn lightly under the route.

### Snapping

The MVP uses **nearest graph vertex** snapping, not segment projection/splitting. This is
deliberate and documented in the UI. Consequences:

- The route endpoint is a real graph vertex; a dashed line on the map shows the offset
  between each OSM platform point and its snapped road vertex.
- The stop list displays the offset. Stops farther than 150 m from any drivable vertex are
  not offered (3 campus-internal platforms in this extract). The worst kept stop is 84.5 m.
- The destination platform lies inside the campus where the extract has no drivable roads,
  so it snaps **164.8 m** to the nearest perimeter road vertex. This is expected for this
  data and is called out in `NOTES.md`.
- Two stops that snap to the same vertex remain separate stop records. Their leg distance
  is 0 m and the simulation pauses at both; the map pins overlap, while the sidebar keeps
  the passenger counts editable.

A production version would project onto the nearest edge and split it, respecting the
one-way direction. That is intentionally out of scope for this MVP.

## Algorithms

### Level 1 — Dijkstra (hand-written)

`src/lib/dijkstra.ts` uses the binary min-heap in `src/lib/heap.ts` (no library) with lazy
deletion. Tie-breaking uses `(distance, vertex id)`, so logs are deterministic.

For every run it records:

- one row per settled vertex: `step`, `vertex`, `d(u)`, every outgoing relaxation with
  `weight`, candidate `d(v)`, and whether it improved;
- `prev[]`, final `dist[]`, settled/relaxation/update counts.

Edges to already-settled vertices are not recorded (they cannot relax). The frontier
snapshot at a step is reconstructed by replaying the log through the same heap and
deduplicating to the best tentative entry per unsettled vertex; this avoids storing a huge
queue array per step. Stale entries from lazy deletion are counted separately.

The matrix is built by running Dijkstra from **every** key point (start, each stop, and the
destination), so the full square matrix is available and any directed pair can be inspected.

### Level 2 — Held-Karp (exact)

`src/lib/heldKarp.ts` fixes the start as origin and the destination as the final node and
runs DP over stop subsets (`O(2^n·n^2)` for n ≤ 9). No symmetry shortcuts are used because
one-way streets make `d(A,B) ≠ d(B,A)`. A zero-stop trip is handled too.

- Unreachable pairs produce `Infinity`; if no complete order exists, the app shows a clear
  error listing the blocked directed pairs instead of producing a broken route.
- For ≤7 stops, the app also enumerates all orders to show the next-best feasible orders
  with their delta to the optimum. For 8–9 stops only the exact optimum is shown.
- The chosen legs are reconstructed with `prev[]` and stitched into one polyline for the
  map and animation.

Measured locally: a 9-stop matrix + Held-Karp solve is **~40 ms**; the Vitest gate is
**< 2 s** (acceptance criterion 5).

## Dijkstra visualization

The **Dijkstra log** tab supports:

- a route-leg chip row plus independent `from` / `to` selects for **any** pair of key points;
- the final shortest path distance, vertex count and expandable vertex sequence;
- settled / frontier / per-step updates / total updates counters;
- playback at 10, 20 or 60 settlements per second, prev / next / end / reset, and a step
  slider (`0` = initial queue before the first settlement);
- a frontier card showing the nearest queued vertices, their best tentative distance, and
  whether they are on the final path;
- filters **Updates only** and **Final path only**, with independent counts;
- pagination at 25/50/100 rows per page and a “go to current step” shortcut;
- a table with `Step | Settled vertex | d(u) | Relaxed edges (u→v, w, d(v), updated) | prev(v)`.

The map stays in sync: settled vertex (green ring), frontier (amber dots), improved edges
(violet), non-improving relaxations (grey dashed), final path (dotted black), and source /
target rings. The full route is muted while the Dijkstra overlay is active.

## Simulation

- The geometry is a single stitched polyline with a cumulative distance array.
- `requestAnimationFrame` advances the bus at `speed × 55 m/s` (speed 1×–8×).
- At each pickup the bus pauses for 1.4 s, increments onboard by that stop's passenger
  count, marks the pin green with a check, and shows a pickup toast.
- At the destination the completion card reports total distance, visit order (S/A–I/T) and
  passengers delivered. Onboard can never exceed 20 because the run is blocked above 20.
- Timeline scrubbing recomputes onboard and picked-up stops from the events already passed.
- Follow-bus, road-network toggle and fit-route controls are on the map.

## Testing

```bash
npm test
```

The suite covers:

| Area | What is checked |
| --- | --- |
| `heap.test.ts` | heap ordering, ties, empty behaviour |
| `dijkstra.test.ts` | one-way reverse is longer; pure one-way yields no reverse; 60 random graphs × all sources vs independent SPFA; **20 random real-network pairs** vs SPFA; path edge sums; monotone settlement log; frontier replay |
| `heldKarp.test.ts` | random asymmetric matrices n=1..7 vs brute force; sparse/unreachable matrices; zero-stop trip; 9-stop DP speed |
| `buildGraph.test.ts` | real-data counts and components; endpoints/stops in the main component; stop snap distances; direction tags; `oneway=yes`/`-1` edge building; bridge crossing does not connect |
| `route.test.ts` | 9-stop route under 2 s; 10 legs; stitched geometry and pickup passengers; asymmetric matrix; **random real-graph subsets of 4–7 stops vs brute force**; passenger sum; unreachable reporting |

The suite builds the graph from `export.geojson` in one test and loads `public/graph.json`
in the others, so `pretest` regenerates the JSON first.

### External networkx check (optional)

The unit tests use an independent SPFA reference. For an extra, external check:

```bash
python3 -m venv .venv
.venv/bin/pip install networkx
npm run verify:pairs
.venv/bin/python scripts/verify-networkx.py /tmp/busway-reference-pairs.json
```

It compares 20 random vertex pairs plus start↔destination against
`networkx.dijkstra_path_length`. On this dataset: **22/22 match, max |Δ| = 0.000000 m**
(including one unreachable pair).

## Configuration

Edit `src/config.ts`:

```ts
START_NODE_ID = 'node/6046633874';        // 공릉 (Gongneung) station
DESTINATION_NODE_ID = 'node/5547152188';  // 서울과학기술대학교정문앞
ALT_STATION_NODE_ID = 'node/6041673026';  // 석계 (Seokgye), kept for swapping
MAX_STOPS = 9;
BUS_CAPACITY = 20;
MAX_STOP_SNAP_METERS = 150;
BASE_SIM_SPEED = 55;                      // metres per animation second at 1×
STOP_DWELL_MS = 1400;
```

After changing an endpoint, run `npm run build:graph` (or just `npm run dev` / `npm test`,
which do it automatically). The endpoints must exist in `export.geojson` as Point features;
the builder throws a clear error if an ID is missing. `ALT_STATION_NODE_ID` is intentionally
unused so swapping the start is a one-line change.

To change the data, replace `export.geojson` and rebuild. The graph builder is independent
of the UI and is covered by tests.

## Notes, assumptions, data problems

See [NOTES.md](./NOTES.md) for the concise list. The main ones:

- nearest-vertex snapping (not segment splitting);
- destination is 164.8 m inside the campus and snaps to the perimeter road;
- 8 disconnected components, 4 stop records (3 distinct names) outside the largest
  strongly connected component (unreachable in at least one direction — the UI reports this
  cleanly);
- duplicate stop names (opposite-side platforms) are kept as distinct stops and badged in
  the list;
- no live traffic, bus route or timetable constraints.

## Out of scope

Multiple buses, time windows, traffic/speed-based weights, real bus-route/timetable
constraints, a backend/database, user accounts.

## Attribution

Road, stop and station data: OpenStreetMap contributors, via Overpass Turbo
(`export.geojson`). Basemap: OpenStreetMap standard tiles, muted with CSS for map legibility.
No tile API key is required.
