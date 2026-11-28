# Assumptions and data problems

This note records the choices made for the MVP and the issues found in `export.geojson`.

## Snapping

- **Nearest-vertex snapping** is used, not nearest-edge projection with edge splitting.
  This is the explicitly allowed MVP simplification. Every route endpoint is therefore a
  real graph vertex.
- Stops, the start and the destination are snapped only to vertices in the **largest weakly
  connected component**. The dashed lines on the map show the actual offset.
- A stop whose nearest drivable vertex is more than **150 m** away is not offered for
  selection. Three campus-internal platforms are excluded: `대학본부앞` (×2) and `붕어방`.
  The worst kept stop snap is 84.5 m.
- Multiple stops that snap to the same vertex are kept as distinct stop records. Their
  connecting leg has zero distance and the animation pauses at each; the sidebar remains
  the source of truth for passenger counts when pins overlap.

## Endpoint data issues

- **Destination 164.8 m from the road.** `서울과학기술대학교정문앞` (`node/5547152188`) is
  inside the campus, and this extract contains no drivable ways inside the campus. Its
  nearest drivable vertex is on the perimeter road (공릉로). The route therefore ends at the
  nearest perimeter vertex; the 164.8 m offset is shown in the UI and on the map. This is a
  data/geography issue, not a routing bug.
- **Start 2.8 m offset.** Gongneung station (`node/6046633874`) snaps almost directly onto
  the road vertex.
- Seokgye station (`node/6041673026`) is kept as `ALT_STATION_NODE_ID` in `src/config.ts`
  but is not used.

## Graph / connectivity issues

- The drivable extract has **5,161 raw vertices**, split into **8 weakly connected
  components**: `5089, 23, 14, 14, 13, 3, 3, 2`. Only the 5,089-vertex main component is
  kept; 109 directed segments that touch the smaller components are dropped.
- The main component's **largest strongly connected component has 5,008 vertices**. That
  means some one-way traps remain. Four stop records (three distinct names) snap outside the
  largest SCC: `노원구민의전당`, `서울시립북미술관`, and two `화랑대사거리` platforms. They
  are reachable in some directions but not others. Selecting one can make a complete trip
  impossible; the UI reports the exact unreachable directed pairs instead of drawing a
  broken route. (Verified manually with `서울시립북미술관`: start → stop works, stop →
  destination does not.)
- **Bridges and tunnels** are connected only through shared endpoint coordinates, exactly
  as specified. A bridge that geometrically crosses another road at a different `layer` is
  not joined to it unless the two ways share a rounded coordinate. A synthetic test covers
  this.
- Three LineString features are omitted: one `motor_vehicle=no` way and two ways tagged
  `service=parking_aisle` (including the two tagged `highway=residential`). Footways, paths,
  cycleways and steps are not part of the graph.
- Parallel directed edges are deduplicated by keeping the shortest weight. There are no
  self-loops in the built graph.
- The campus polygon (`way/380910936`) is ignored for routing; the destination is defined by
  the gate stop node. The OSM basemap shows the campus for context.

## Stop data / ambiguity

- Many stop names occur more than once. These are usually platforms on opposite sides of a
  street or in different directions. They are **not merged**: they have different OSM IDs,
  coordinates and potentially different snapped vertices, and the list shows a `2×`/`3×`
  badge so the ambiguity is visible. Choosing the wrong platform can produce a different
  result, especially with one-way streets.
- Bus stop points are not on road geometry; the offsets are visible in the list and in the
  dashed snap connectors.
- `route_ref` values are displayed as context only. The MVP deliberately ignores real bus
  routes and timetables.

## Routing assumptions

- Edge weight = Haversine distance in metres; travel time, traffic and turn restrictions are
  not modelled.
- `oneway=yes` follows coordinate order; `oneway=-1` reverses; `junction=roundabout` is
  one-way in coordinate order unless `oneway=no`; everything else is bidirectional.
- Roads are free to use by the bus; there is no `route_ref` filter.
- The visiting order is exact for the directed matrix, but the matrix itself is restricted
  to snapped key-point vertices and the drivable road network in this extract. It is not a
  full city routing engine.

## UI/testing assumptions

- The map uses standard OpenStreetMap tiles, visually muted with CSS. No tile key is needed.
- The simulation speed (1× = 55 m/s) and 1.4 s stop dwell are presentation choices, not
  realistic vehicle physics.
- The graph builds in ~70–90 ms. The full n=15 Held-Karp solve measured **~31 ms** with
  **4.22 MB** of DP arrays (heap delta ~5.7 MB); n=10 and n=12 measured ~2.3 ms and ~3.7 ms.
  The Vitest gate for the real 9-stop route is still 2 s.
- There is no stop-count cap. The only hard run limit is the 20-passenger bus capacity; the
  UI keeps the existing over-capacity message and blocks the run.
- Dijkstra step logs record relaxations to unsettled vertices only. Edges to already-settled
  vertices are skipped because they cannot improve a distance.
- The matrix runs n+1 searches (start + each stop) with early exit when all key-point targets
  are settled. Step logs are recorded lazily for only the leg the user inspects.
- The frontier is reconstructed from the settlement log rather than storing a queue snapshot
  for every step; it is deduplicated to the best tentative distance per vertex, with stale
  lazy-heap entries counted separately.
- Random scenarios and the benchmark use a reproducible mulberry32 seed. Candidate stops are
  deduplicated by snapped vertex; on this extract 233 candidates remain, 54 records were
  merged and 4 were excluded as unreachable.
- Presets are generated by `scripts/find-presets.ts`, not hand-picked. The script searches
  seeded k=6/8/10/12 scenarios and stores stop ids + seed + measured greedy gap.
