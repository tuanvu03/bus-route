# Campus Loop

A single-bus pickup route simulator for the area around Seoul National University of
Science and Technology (SNUST / 서울과학기술대학교) in Nowon-gu, Seoul.

Pick any number of waiting bus stops (the only hard rule is the 20-passenger capacity), set how
many passengers are waiting at each, and solve the visiting order on the real directed road
graph. You can compare three modes: **greedy Dijkstra only**, **Dijkstra + Held-Karp**, or a
side-by-side comparison of both. It then animates one 20-seat bus from Gongneung station,
through every pickup, to the campus gate — and exposes the full Dijkstra calculation, step by
step, for teaching and inspection.

It also ships a seeded random-scenario generator, reproducible presets, and a benchmark page
that measures how much Held-Karp actually saves over greedy on this map.

![Stack](https://img.shields.io/badge/React-19-0c6b58) ![Stack](https://img.shields.io/badge/TypeScript-strict-0c6b58) ![Stack](https://img.shields.io/badge/Vite-8-0c6b58) ![Tests](https://img.shields.io/badge/tests-43%20passing-0c6b58)

## Quick start

```bash
npm install
npm run dev          # builds public/graph.json, then starts Vite on http://127.0.0.1:5173
```

Other commands:

```bash
npm run build:graph  # export.geojson -> public/graph.json (also prints the data report)
npm run build          # rebuild graph, type-check, production bundle
npm test               # rebuild graph, then run the Vitest suite
npm run preview        # serve the production build
npm run find-presets   # seeded search -> presets.json (also ./scripts/find-presets)
npm run benchmark:heldkarp  # measured n=10/12/15 time + memory for the README
```

There is no backend. Everything — graph construction, Dijkstra, Held-Karp, snapping,
animation — runs in the browser (or in Node for the build/tests).

## What the app does

1. **Choose waiting stops.** Click dots on the map or rows in the left list. A stop can be
   removed by clicking it again. Each selected stop defaults to 1 passenger and can be
   edited between 1 and 20. **There is no stop-count cap.** The total must stay ≤ 20; above
   that the existing capacity message appears and the run is blocked.
2. **Choose a mode.**
   - **Mode A — Dijkstra only (greedy nearest stop).** From the current point, repeatedly
     take the nearest not-yet-visited stop by directed road distance, then finally go to the
     destination. Ties are broken by the smaller graph vertex id. No permutation search, so
     it works for any number of stops.
   - **Mode B — Dijkstra + Held-Karp (optimised order).** Build the directed matrix, find
     the exact optimal order with Held-Karp, then stitch the Dijkstra paths.
   - **Mode C — Compare A vs B (default).** Run both on the same matrix and show visiting
     orders, total/per-leg distances, solve times, improvement, and the first leg where the
     two orders diverge.
3. **Run the optimiser in a Web Worker.** The matrix uses n+1 Dijkstra searches for n stops
   (start + each stop) with early exit once all targets are settled. Held-Karp/heuristic runs
   in a worker with progress and Cancel, so the UI stays responsive.
4. **Inspect the algorithm.** The right-hand **Dijkstra log** tab lazily computes only the
   leg you open: settlement table, frontier snapshot, relaxed edges, shortest path, filters,
   pagination and map highlighting. The **Matrix** tab shows the directed matrix (paginated
   above 24 key points) and lets you click any computed cell to open that leg.
5. **Animate the trip.** Play / pause / reset, scrub the timeline, change speed. The bus
   pauses at each pickup, the onboard counter updates, and the completion summary names the
   algorithm that produced the animated route, its distance, the visit order and passengers
   delivered.
6. **Try random or preset scenarios.** Generate k stops from a seed (copy/paste the seed to
   reproduce), or load one of six presets whose greedy gaps were found by a seeded search.
7. **Benchmark on this map.** Run k = 2…15 with 200 scenarios per k, view gap charts, inspect
   the worst cases, and load any scenario into the simulator in Mode C.

The **Demo** button loads a six-stop, 16-passenger trip in Compare mode so the full
experience is one click away.

## Project layout

```
export.geojson                  Source Overpass Turbo extract (committed)
presets.json                    Generated preset scenarios (seed + stop ids + measured gap)
scripts/
  build-graph.ts                GeoJSON -> public/graph.json preprocessing
  find-presets.ts               Seeded search for the six UI presets
  benchmark-heldkarp.ts         Measured n=10/12/15 time + memory
  export-reference-pairs.ts     Export app distances for external verification
  verify-networkx.py            Optional networkx cross-check
public/graph.json               Generated, ready-to-load graph (≈690 KB)
src/
  config.ts                     Endpoints, capacity, HELD_KARP_MAX_STOPS, seeds, sim speed
  lib/
    buildGraph.ts               Pure GeoJSON -> graph builder (also used by tests/script)
    types.ts                    Graph / stop / serialized types
    geo.ts                      Haversine, 7-decimal coordinate keys
    heap.ts                     Hand-written binary min-heap
    dijkstra.ts                 Dijkstra + settlement log + early-stop distance searches
    heldKarp.ts                 Flat-array Held-Karp + greedy + asymmetric-safe Or-opt
    route.ts                    Modes A/B/C, shared matrix, stitched geometry, comparison
    scenario.ts                 Candidate stops + seeded random scenarios
    benchmark.ts                Cached-Dijkstra benchmark harness + CSV export
    random.ts                   mulberry32, seed derivation, sampling
    loadGraph.ts                Browser graph loader
    format.ts, labels.ts        Formatting and S/A–B/T key-point labels
  workers/
    solver.worker.ts            Matrix + Mode A/B/C solve off the main thread
    benchmark.worker.ts         Dijkstra cache + all benchmark scenarios off-thread
  hooks/useSimulation.ts        requestAnimationFrame simulation state machine
  components/                   Map, sidebar, inspector, compare view, benchmark, charts
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

The matrix is built with **n+1 searches for n stops** (start + each stop), not the previous
n+2. The destination is terminal, so its outgoing row is not computed. Each search stops as
soon as all key-point targets are settled. Only `dist[]` and `prev[]` are retained — no
settlement log — so a 40-stop matrix does not allocate 42 giant step logs. The Dijkstra log
for a leg is recorded lazily, only when the user opens that leg.

### Mode A — greedy (Dijkstra only)

`greedyVisitOrder()` repeatedly picks the nearest unvisited stop from the current point using
the directed matrix (which is exactly what step-by-step Dijkstra would find), then finally
goes to the destination. Ties are broken by **smaller graph vertex id**, then matrix index.
There is no permutation search and no stop-count limit.

### Mode B — Held-Karp (exact)

`src/lib/heldKarp.ts` fixes the start as origin and the destination as the final node and
runs DP over stop subsets. No symmetry shortcuts are used because one-way streets make
`d(A,B) ≠ d(B,A)`. A zero-stop trip is handled too.

- Implementation uses **flat typed arrays**: `Float64Array` for costs and
  `Int8Array`/`Int16Array` for parent pointers. No `Map` or nested DP arrays.
- Complexity is **O(n²·2ⁿ) time and O(n·2ⁿ) memory**. The default
  `HELD_KARP_MAX_STOPS = 15` keeps a tab-safe solve; the Advanced settings panel lets the
  user raise it (hard UI limit 20) after a slow/out-of-memory warning.
- Unreachable pairs produce `Infinity`; if no complete order exists, the app shows a clear
  error listing the blocked directed pairs instead of producing a broken route.
- For ≤7 stops the app enumerates all orders for the next-best list; for larger n it shows a
  few valid local perturbations instead.

### Heuristic fallback (n > HELD_KARP_MAX_STOPS)

When the selected stop count exceeds the limit, the app does **not** start Held-Karp. It shows:

> Exact optimization (Held-Karp) is not available for n > X stops. Using a heuristic
> instead; the result is NOT guaranteed optimal.

and runs **nearest neighbour + Or-opt**. Or-opt moves segments of 1–3 stops without reversing
them, which is valid for an asymmetric matrix. Reversal-based 2-opt is deliberately not used:
reversing a segment would assume `d(i,j) = d(j,i)`, which one-way streets violate. The start
and destination stay fixed, and every result is labelled **“Heuristic (not proven optimal)”**.

### Shared matrix and comparison

Mode C runs greedy and exact/heuristic on the **same matrix**, so the comparison is fair.
It reports metres and percent saved, says explicitly when greedy already found the optimal
order, and highlights the first leg where the two visiting orders diverge. The Dijkstra log
is available for any leg in either mode.

### Held-Karp measurements on this map

Measured with `NODE_OPTIONS=--expose-gc npm run benchmark:heldkarp` (Node 24, same flat
typed arrays as the worker). “Heap delta” is sampled around the solve and is noisy; “DP
arrays” is the exact allocation `n·2ⁿ·(8+1)` bytes and is the more stable peak-memory
figure.

| n | time | heap delta | DP arrays (peak) | distance |
| --- | --- | --- | --- | --- |
| 10 | 2.34 ms | 0.64 MB | 0.09 MB | 8.55 km |
| 12 | 3.65 ms | 0.28 MB | 0.42 MB | 9.54 km |
| 15 | 30.71 ms | 5.67 MB | 4.22 MB | 10.05 km |

The browser runs these in `solver.worker.ts`; the Vitest gate for the real 9-stop route is
still < 2 s, and even the 31 ms n=15 solve happens off the main thread so the map and inputs
stay responsive.

## Dijkstra visualization

The **Dijkstra log** tab supports:

- a route-leg chip row (union of Mode A and Mode B legs) plus independent `from` / `to`
  selects for **any** pair of key points;
- lazy logs: only the currently inspected leg is computed and kept, so large stop sets do
  not blow up memory;
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
- At the destination the completion card reports the algorithm that produced the animated
  route, total distance, visit order and passengers delivered. Onboard can never exceed 20
  because the run is blocked above 20.
- Timeline scrubbing recomputes onboard and picked-up stops from the events already passed.
- Follow-bus, road-network toggle and fit-route controls are on the map.
- In Mode C the map draws A and B in orange/blue with a legend, visibility toggles, first-
  divergence highlight, and an A/B selector for the animated bus.

## Random scenarios

The **Random scenario** panel picks k stops from the valid candidate set:

- candidates are stops reachable from the start **and** from which the destination is
  reachable; stops that snap to the same graph vertex are merged (the UI reports how many);
- passenger count defaults to 1 per stop, so k > 20 triggers the existing capacity message
  and the run is blocked;
- a seed is required for reproducibility. Numeric seeds are used directly; text is hashed
  with FNV-1a. The same seed + k + candidate list always produces the same stops;
- after generation the selected mode auto-runs (default Mode C).

## Presets

`presets.json` contains six scenarios found by `npm run find-presets`, never hand-picked:
Easy, Opposite sides, One-way trap, Far from campus first, Worst found (k=8), Worst found
(k=12). The script evaluates seeded scenarios (k = 6/8/10/12, 320 trials each), ranks them by
the greedy gap and geometric category, and writes stop ids + seed + measured gap.

Category rules are explicit in the script: Easy requires a zero gap and lateral spread under
1.5 km; Opposite sides requires stops more than 100 m on both sides of the start→campus axis;
One-way trap ranks positive gaps by the first greedy detour ratio and matrix asymmetry;
Far-from-campus-first ranks gaps where the last greedy stop is far from the destination.
The UI shows each preset's measured gap and reloads it in Compare mode. A fresh run matches
the stored numbers because both use the same graph, scenario seed and solvers. If a category
cannot be found on a future map extract, the script substitutes the next-best scenario
instead of inventing data.

Measured on the current extract:

| Preset | k | Greedy gap |
| --- | --- | --- |
| Easy | 6 | 0.0 m (0.00%) |
| Opposite sides | 6 | 0.0 m (0.00%) |
| One-way trap | 12 | 5,979.3 m (45.49%) |
| Far from campus first | 12 | 6,026.0 m (44.53%) |
| Worst found (k=8) | 8 | 5,410.6 m (45.57%) |
| Worst found (k=12) | 12 | 6,026.0 m (44.53%) |

## Benchmark

The **Benchmark** page measures the benefit of Held-Karp over greedy on this network.

Inputs: k list (`2..15` by default), scenarios per k (200), base seed, passengers per stop,
and the Held-Karp limit. For every k it reports:

- percentage of scenarios where greedy is optimal (within 0.5 m);
- mean / median / p90 / max gap in metres and percent over optimal;
- mean greedy and Held-Karp/heuristic computation time;
- scenarios skipped for unreachable pairs (should be 0) and assertion violations.

The worker computes a fixed candidate set and **caches one Dijkstra result (distance +
predecessor) per source vertex once**, then reuses it for every scenario. No Dijkstra search
is rerun per scenario. Results stream in per k with a progress bar and Cancel; charts show
gap % vs k (mean line + p90 band) and greedy optimal rate vs k. Click any scenario (or
“Show worst”) to load it into the simulator in Mode C. CSV/JSON export includes seed, k,
index, stop ids, both orders/distances and the gap.

The harness asserts `optimal ≤ greedy + ε` for every exact solve and flags/logs violations.
On a full default run (200 scenarios × k = 2…15) the measured numbers were:

```
cache 296 ms · total 9.0 s · skipped 0 · violations 0
k= 2  greedy optimal 52.0%  mean gap  264.5 m (5.25%)   p90  925.8 m
k= 4  greedy optimal 24.5%  mean gap  768.0 m (9.68%)   p90 1710.3 m
k= 8  greedy optimal  5.0%  mean gap 1411.8 m (12.45%)  p90 2674.4 m
k=12  greedy optimal  3.0%  mean gap 2023.9 m (14.81%)  p90 3671.0 m
k=15  greedy optimal  1.0%  mean gap 2426.4 m (16.10%)  p90 4244.6 m
```

Interpretation: greedy is usually not optimal even at small k; the average penalty grows
from a few hundred metres to ~2.4 km at k=15, while the share of greedy-optimal scenarios
drops to ~1%. That is the practical case for paying the Held-Karp cost on this map.

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
| `buildGraph.test.ts` | real-data counts and components; endpoints/stops in the main component; stop snap distances; direction tags; `oneway=yes`/`-1` edge building; bridge crossing does not connect; capacity/HK defaults |
| `route.test.ts` | 9-stop route under 2 s; 10 legs; stitched geometry and pickup passengers; asymmetric matrix; **random real-graph subsets of 4–7 stops vs brute force**; passenger sum; unreachable reporting |
| `algorithmModes.test.ts` | Mode A greedy order on a one-way graph; deterministic vertex-id tie-break; Mode C positive gap on a provably suboptimal graph; exact ≤ greedy on random subsets ≤8; heuristic fallback + required warning above 15; 25/40-stop runs; comparison totals match geometry; small exact vs brute force |
| `scenarioBenchmark.test.ts` | candidate dedupe/reachability; same seed reproduces stops and routes; capacity message; benchmark reproducibility and `optimal ≤ greedy`; benchmark scenario reload; p90 statistics; preset gaps match fresh runs |

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
BUS_CAPACITY = 20;                        // no stop-count cap
HELD_KARP_MAX_STOPS = 15;                 // automatic exact-solver limit
HELD_KARP_HARD_LIMIT = 20;                // UI will not accept more
MAX_STOP_SNAP_METERS = 150;
BASE_SIM_SPEED = 55;                      // metres per animation second at 1×
STOP_DWELL_MS = 1400;
DEFAULT_BENCHMARK_SCENARIOS = 200;
DEFAULT_SCENARIO_SEED = 20261127;
```

**How to change the Held-Karp limit.** Edit `HELD_KARP_MAX_STOPS` in `src/config.ts` for the
new default, or use **Advanced settings → Held-Karp max stops** in the UI for a one-off
raise. Raising it above 15 warns about slowness/out-of-memory; the UI hard-caps at 20
(~168 MB of DP cost arrays) to avoid crashing the tab. n > the limit automatically uses the
labelled heuristic fallback instead of freezing.

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
  the list; random scenarios merge stops that snap to the same graph vertex (54 records on
  this extract) so the same road vertex is not counted twice;
- the 233 random-scenario candidates are reachable from the start and can reach the
  destination; 4 stop records are excluded as unreachable in at least one direction;
- no live traffic, bus route or timetable constraints.

## Out of scope

Multiple buses, multi-trip capacity routing (CVRP), time windows, traffic/speed-based
weights, real bus-route/timetable constraints, backend solvers, user accounts. Branch &
Bound for 16–25 stops may be added later as an optional extension; the current fallback is
nearest neighbour + Or-opt, explicitly labelled “not proven optimal”.

## Attribution

Road, stop and station data: OpenStreetMap contributors, via Overpass Turbo
(`export.geojson`). Basemap: OpenStreetMap standard tiles, muted with CSS for map legibility.
No tile API key is required.
