import { Fragment, memo, useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { Coord, Graph, StopInfo } from '../lib/types';
import { vertexCoord } from '../lib/types';
import type { AlgorithmMode, Comparison, RoutePlan, SelectedStop } from '../lib/route';
import type { FrontierEntry, Relaxation } from '../lib/dijkstra';
import { ArrowRightIcon, LayersIcon, TargetIcon } from './Icons';

export interface DijkstraMapView {
  sourceVertex: number;
  targetVertex: number;
  settledVertex: number | null;
  frontier: FrontierEntry[];
  relaxed: Relaxation[];
  path: number[];
  stepIndex: number;
  stepCount: number;
}

type AnimMode = 'greedy' | 'optimal';

interface MapViewProps {
  graph: Graph;
  selected: SelectedStop[];
  plan: RoutePlan | null;
  greedyPlan: RoutePlan | null;
  optimalPlan: RoutePlan | null;
  comparison: Comparison | null;
  mode: AlgorithmMode;
  animMode: AnimMode;
  routeVisibility: { greedy: boolean; optimal: boolean };
  onToggleRoute: (target: 'greedy' | 'optimal') => void;
  dijkstra: DijkstraMapView | null;
  busCoord: Coord | null;
  busLegIndex: number;
  showBus: boolean;
  onboard: number;
  pickedUp: string[];
  follow: boolean;
  showRoads: boolean;
  onToggleStop: (stop: StopInfo) => void;
  onToggleRoads: () => void;
  onToggleFollow: () => void;
}

const toLL = (c: Coord): [number, number] => [c[1], c[0]];

const ROAD_STYLES: Record<string, { color: string; weight: number; opacity: number }> = {
  motorway: { color: '#c5beb0', weight: 4.2, opacity: 0.95 },
  trunk: { color: '#c5beb0', weight: 4, opacity: 0.95 },
  primary: { color: '#c9c2b4', weight: 3.4, opacity: 0.95 },
  secondary: { color: '#d3ccbe', weight: 2.7, opacity: 0.95 },
  tertiary: { color: '#dbd5c9', weight: 2.2, opacity: 0.95 },
  unclassified: { color: '#e2ddd3', weight: 1.5, opacity: 0.9 },
  residential: { color: '#e5e0d7', weight: 1.4, opacity: 0.9 },
  service: { color: '#eae6de', weight: 1, opacity: 0.8 },
};

const BUS_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.4" y="3.4" width="13.2" height="11.4" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.2 14.8v2M13.8 14.8v2M3.4 10h13.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6.7" cy="12.2" r=".8" fill="currentColor"/><circle cx="13.3" cy="12.2" r=".8" fill="currentColor"/></svg>';
const STATION_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3.4" width="12" height="10.4" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 12.4h12M7 17l2-2m4 2-2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7.2" cy="8" r=".8" fill="currentColor"/><circle cx="12.8" cy="8" r=".8" fill="currentColor"/></svg>';
const FLAG_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 17V3.5h8.5l-1.8 3.4 1.8 3.4H5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.2 3.6 3.6 7.4-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function useDivIcon(html: string, className: string, size = 32) {
  return useMemo(
    () =>
      L.divIcon({
        className: `map-div-icon ${className}`,
        html,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
    [html, className, size],
  );
}

const StopMarkers = memo(function StopMarkers({
  stops,
  selectedById,
  pickedUp,
  onToggleStop,
}: {
  stops: StopInfo[];
  selectedById: Map<string, number>;
  pickedUp: Set<string>;
  onToggleStop: (stop: StopInfo) => void;
}) {
  return (
    <>
      {stops.map((stop) => {
        const count = selectedById.get(stop.id);
        const isSelected = count !== undefined;
        const isPicked = pickedUp.has(stop.id);
        if (!isSelected) {
          return (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lon]}
              radius={3.4}
              pathOptions={{
                color: '#626a78',
                weight: 1,
                opacity: 0.75,
                fillColor: '#fbfaf7',
                fillOpacity: 0.95,
              }}
              eventHandlers={{ click: () => onToggleStop(stop) }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
                <span className="map-tooltip-title">{stop.name}</span>
                <span className="map-tooltip-meta">Click to add · snap {stop.snapDistance.toFixed(0)} m</span>
              </Tooltip>
            </CircleMarker>
          );
        }
        return (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lon]}
            icon={L.divIcon({
              className: 'map-div-icon',
              html: `<div class="stop-count-pin ${isPicked ? 'picked' : ''}">${
                isPicked ? CHECK_SVG : count
              }</div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}
            zIndexOffset={500}
            eventHandlers={{ click: () => onToggleStop(stop) }}
          >
            <Tooltip direction="top" offset={[0, -15]} opacity={0.97}>
              <span className="map-tooltip-title">{stop.name}</span>
              <span className="map-tooltip-meta">
                {isPicked ? 'Picked up' : `${count} waiting`} · click to remove
              </span>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
});

function MapActions({
  plan,
  graph,
  showRoads,
  onToggleRoads,
  follow,
  onToggleFollow,
}: {
  plan: RoutePlan | null;
  graph: Graph;
  showRoads: boolean;
  onToggleRoads: () => void;
  follow: boolean;
  onToggleFollow: () => void;
}) {
  const map = useMap();

  const fitGraph = () => {
    const bounds = L.latLngBounds(
      Array.from({ length: graph.coords.length / 2 }, (_, i) =>
        L.latLng(graph.coords[i * 2 + 1], graph.coords[i * 2]),
      ),
    );
    map.fitBounds(bounds.pad(0.04));
  };

  const fitRoute = () => {
    if (!plan) {
      fitGraph();
      return;
    }
    const bounds = L.latLngBounds(plan.geometry.coords.map(toLL));
    map.fitBounds(bounds.pad(0.12));
  };

  return (
    <div
      className="map-actions"
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="map-action" onClick={fitRoute} title="Fit route">
        <TargetIcon size={15} />
        <span>Fit</span>
      </button>
      <button
        type="button"
        className={`map-action ${showRoads ? 'is-on' : ''}`}
        onClick={onToggleRoads}
        title="Toggle road network"
      >
        <LayersIcon size={15} />
        <span>Roads</span>
      </button>
      <button
        type="button"
        className={`map-action ${follow ? 'is-on' : ''}`}
        onClick={onToggleFollow}
        title="Follow the bus"
      >
        <ArrowRightIcon size={15} />
        <span>Follow</span>
      </button>
    </div>
  );
}

function FitOnPlan({ plan, graph }: { plan: RoutePlan | null; graph: Graph }) {
  const map = useMap();
  const graphKey = graph.coords.length;

  useEffect(() => {
    if (plan) {
      const bounds = L.latLngBounds(plan.geometry.coords.map(toLL));
      map.fitBounds(bounds.pad(0.14));
    } else {
      const bounds = L.latLngBounds(
        Array.from({ length: graph.coords.length / 2 }, (_, i) =>
          L.latLng(graph.coords[i * 2 + 1], graph.coords[i * 2]),
        ),
      );
      map.fitBounds(bounds.pad(0.05));
    }
    // graphKey intentionally captures a new graph instance.
  }, [plan, graph, graphKey, map]);
  return null;
}

function FollowBus({ coord, enabled }: { coord: Coord | null; enabled: boolean }) {
  const map = useMap();
  const lon = coord?.[0];
  const lat = coord?.[1];
  useEffect(() => {
    if (lon === undefined || lat === undefined || !enabled) return;
    map.panTo([lat, lon], { animate: false });
  }, [lon, lat, enabled, map]);
  return null;
}

const SnapLayers = memo(function SnapLayers({
  graph,
  selected,
}: {
  graph: Graph;
  selected: SelectedStop[];
}) {
  return (
    <>
      {[graph.start, graph.destination, ...selected.map((s) => s.stop)].map((point) => {
        const vertex = vertexCoord(graph, point.vertex);
        return (
          <Polyline
            key={`snap-${point.id}`}
            positions={[
              [point.lat, point.lon],
              toLL(vertex),
            ]}
            pathOptions={{
              color: '#8b8578',
              weight: 1,
              opacity: 0.7,
              dashArray: '2 4',
              interactive: false,
            }}
          />
        );
      })}
    </>
  );
});

const RouteLayers = memo(function RouteLayers({
  graph,
  plan,
  muted,
}: {
  graph: Graph;
  plan: RoutePlan;
  muted: boolean;
}) {
  return (
    <>
      {plan.legs.map((leg, i) => (
        <Polyline
          key={`leg-casing-${i}`}
          positions={leg.path.map((v) => toLL(vertexCoord(graph, v)))}
          pathOptions={{
            color: '#ffffff',
            weight: muted ? 7 : 9,
            opacity: muted ? 0.35 : 0.85,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }}
        />
      ))}
      {plan.legs.map((leg, i) => (
        <Polyline
          key={`leg-${i}`}
          positions={leg.path.map((v) => toLL(vertexCoord(graph, v)))}
          pathOptions={{
            color: leg.color,
            weight: muted ? 3.2 : 5,
            opacity: muted ? 0.28 : 0.96,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }}
        />
      ))}
    </>
  );
});

const MODE_COLORS = { greedy: '#d9682c', optimal: '#2563eb' } as const;

const CompareRouteLayers = memo(function CompareRouteLayers({
  graph,
  plans,
  visibility,
  muted,
}: {
  graph: Graph;
  plans: { key: 'greedy' | 'optimal'; plan: RoutePlan }[];
  visibility: { greedy: boolean; optimal: boolean };
  muted: boolean;
}) {
  return (
    <>
      {plans.map(({ key, plan }) => {
        if (!visibility[key]) return null;
        const color = MODE_COLORS[key];
        return (
          <Fragment key={key}>
            <Polyline
              positions={plan.geometry.coords.map(toLL)}
              pathOptions={{
                color: '#ffffff',
                weight: muted ? 7 : 9,
                opacity: muted ? 0.35 : 0.7,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
              }}
            />
            <Polyline
              positions={plan.geometry.coords.map(toLL)}
              pathOptions={{
                color,
                weight: muted ? 3.2 : 5,
                opacity: muted ? 0.3 : 0.95,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
              }}
            />
          </Fragment>
        );
      })}
    </>
  );
});

const ComparisonHighlight = memo(function ComparisonHighlight({
  graph,
  comparison,
  visibility,
}: {
  graph: Graph;
  comparison: Comparison;
  visibility: { greedy: boolean; optimal: boolean };
}) {
  const divergence = comparison.divergence;
  if (!divergence) return null;
  const greedyLeg = comparison.greedy.legs[divergence.legIndex];
  const optimalLeg = comparison.optimal.legs[divergence.legIndex];
  return (
    <>
      {visibility.greedy && greedyLeg && (
        <Polyline
          positions={greedyLeg.path.map((v) => toLL(vertexCoord(graph, v)))}
          pathOptions={{
            color: MODE_COLORS.greedy,
            weight: 8,
            opacity: 0.32,
            lineCap: 'round',
            dashArray: '5 5',
            interactive: false,
          }}
        />
      )}
      {visibility.optimal && optimalLeg && (
        <Polyline
          positions={optimalLeg.path.map((v) => toLL(vertexCoord(graph, v)))}
          pathOptions={{
            color: MODE_COLORS.optimal,
            weight: 8,
            opacity: 0.32,
            lineCap: 'round',
            dashArray: '5 5',
            interactive: false,
          }}
        />
      )}
      <CircleMarker
        center={toLL(comparison.optimal.points[divergence.greedyTo].coord)}
        radius={7}
        pathOptions={{
          color: MODE_COLORS.greedy,
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 0.45,
        }}
        interactive={false}
      >
        <Tooltip permanent direction="top" offset={[0, -6]} className="step-tooltip">
          A · {comparison.optimal.points[divergence.greedyTo].name}
        </Tooltip>
      </CircleMarker>
      <CircleMarker
        center={toLL(comparison.optimal.points[divergence.optimalTo].coord)}
        radius={7}
        pathOptions={{
          color: MODE_COLORS.optimal,
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 0.45,
        }}
        interactive={false}
      >
        <Tooltip permanent direction="top" offset={[0, -6]} className="step-tooltip">
          B · {comparison.optimal.points[divergence.optimalTo].name}
        </Tooltip>
      </CircleMarker>
    </>
  );
});

const DijkstraLayers = memo(function DijkstraLayers({
  graph,
  dijkstra,
}: {
  graph: Graph;
  dijkstra: DijkstraMapView;
}) {
  const settledIcon = L.divIcon({
    className: 'map-div-icon',
    html: '<div class="settled-pin"></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  return (
    <>
      {dijkstra.path.length > 1 && (
        <Polyline
          positions={dijkstra.path.map((v) => toLL(vertexCoord(graph, v)))}
          pathOptions={{
            color: '#111827',
            weight: 3.2,
            opacity: 0.9,
            dashArray: '1 7',
            lineCap: 'round',
            interactive: false,
          }}
        />
      )}
      {dijkstra.relaxed.slice(0, 24).map((rel, i) => {
        const fromVertex = dijkstra.settledVertex ?? dijkstra.sourceVertex;
        const a = vertexCoord(graph, fromVertex);
        const to = vertexCoord(graph, rel.to);
        return (
          <Polyline
            key={`relax-${i}`}
            positions={[toLL(a), toLL(to)]}
            pathOptions={{
              color: rel.updated ? '#7c3aed' : '#9aa1ad',
              weight: rel.updated ? 2.4 : 1.4,
              opacity: rel.updated ? 0.95 : 0.55,
              dashArray: rel.updated ? undefined : '3 4',
              interactive: false,
            }}
          />
        );
      })}
      {dijkstra.frontier.slice(0, 140).map((entry) => (
        <CircleMarker
          key={`frontier-${entry.vertex}`}
          center={toLL(vertexCoord(graph, entry.vertex))}
          radius={3.2}
          pathOptions={{
            color: '#b45309',
            weight: 1,
            opacity: 0.85,
            fillColor: '#f59e0b',
            fillOpacity: 0.75,
          }}
          interactive={false}
        />
      ))}
      <CircleMarker
        center={toLL(vertexCoord(graph, dijkstra.sourceVertex))}
        radius={9}
        pathOptions={{
          color: '#111827',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 0.2,
          dashArray: '2 2',
        }}
        interactive={false}
      >
        <Tooltip permanent direction="bottom" offset={[0, 8]} className="step-tooltip">
          source
        </Tooltip>
      </CircleMarker>
      <CircleMarker
        center={toLL(vertexCoord(graph, dijkstra.targetVertex))}
        radius={9}
        pathOptions={{
          color: '#111827',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 0.2,
          dashArray: '2 2',
        }}
        interactive={false}
      >
        <Tooltip permanent direction="bottom" offset={[0, 8]} className="step-tooltip">
          target
        </Tooltip>
      </CircleMarker>
      {dijkstra.settledVertex !== null && (
        <Marker
          position={toLL(vertexCoord(graph, dijkstra.settledVertex))}
          icon={settledIcon}
          zIndexOffset={900}
          interactive={false}
        >
          <Tooltip permanent direction="top" offset={[0, -18]} className="step-tooltip">
            settled · v{dijkstra.settledVertex}
          </Tooltip>
        </Marker>
      )}
    </>
  );
});

export function MapView({
  graph,
  selected,
  plan,
  greedyPlan,
  optimalPlan,
  comparison,
  mode,
  animMode,
  routeVisibility,
  onToggleRoute,
  dijkstra,
  busCoord,
  busLegIndex,
  showBus,
  onboard,
  pickedUp,
  follow,
  showRoads,
  onToggleStop,
  onToggleRoads,
  onToggleFollow,
}: MapViewProps) {
  const roadsGeoJSON = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: 'FeatureCollection',
      features: graph.roads.map(
        (road): Feature<LineString> => ({
          type: 'Feature',
          properties: {
            highway: road.highway,
            name: road.name,
            bridge: road.bridge,
            tunnel: road.tunnel,
          },
          geometry: {
            type: 'LineString',
            coordinates: road.coords.map((c) => [c[0], c[1]]),
          },
        }),
      ),
    }),
    [graph],
  );

  const selectedById = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of selected) map.set(s.stop.id, s.passengers);
    return map;
  }, [selected]);

  const pickedKey = pickedUp.join('|');
  const pickedUpSet = useMemo(() => new Set(pickedUp), [pickedKey]);

  const startIcon = useDivIcon(
    `<div class="map-pin map-pin-start">${STATION_SVG}</div>`,
    'pin-start-icon',
    34,
  );
  const destIcon = useDivIcon(
    `<div class="map-pin map-pin-dest">${FLAG_SVG}</div>`,
    'pin-dest-icon',
    36,
  );
  const busColor =
    mode === 'compare'
      ? MODE_COLORS[animMode]
      : plan?.legs[busLegIndex]?.color ?? '#161b22';
  const busIcon = useDivIcon(
    `<div class="bus-pin" style="--bus-color:${busColor}">${BUS_SVG}</div>`,
    'bus-pin-icon',
    38,
  );

  return (
    <MapContainer
      center={[37.6255, 127.072]}
      zoom={14}
      preferCanvas
      zoomControl
      className="map"
      attributionControl
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        subdomains={['a', 'b', 'c']}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      {showRoads && (
        <GeoJSON
          data={roadsGeoJSON}
          interactive={false}
          style={(feature) => {
            const highway = String(feature?.properties?.highway ?? 'residential');
            const style = ROAD_STYLES[highway] ?? ROAD_STYLES.residential;
            return {
              color: style.color,
              weight: style.weight,
              opacity: style.opacity,
              lineCap: 'round',
              lineJoin: 'round',
            };
          }}
        />
      )}

      <FitOnPlan plan={plan} graph={graph} />
      <MapActions
        plan={plan}
        graph={graph}
        showRoads={showRoads}
        onToggleRoads={onToggleRoads}
        follow={follow}
        onToggleFollow={onToggleFollow}
      />
      <FollowBus coord={busCoord} enabled={follow && Boolean(plan)} />

      {/* Snap connectors for the endpoints and selected stops. */}
      <SnapLayers graph={graph} selected={selected} />

      {/* Full route. Compare mode draws both modes in distinct colours. */}
      {mode === 'compare' && (greedyPlan || optimalPlan) ? (
        <>
          <CompareRouteLayers
            graph={graph}
            muted={Boolean(dijkstra)}
            visibility={routeVisibility}
            plans={[
              ...(greedyPlan ? [{ key: 'greedy' as const, plan: greedyPlan }] : []),
              ...(optimalPlan ? [{ key: 'optimal' as const, plan: optimalPlan }] : []),
            ]}
          />
          {comparison && (
            <ComparisonHighlight
              graph={graph}
              comparison={comparison}
              visibility={routeVisibility}
            />
          )}
        </>
      ) : (
        plan && <RouteLayers graph={graph} plan={plan} muted={Boolean(dijkstra)} />
      )}

      <StopMarkers
        stops={graph.stops}
        selectedById={selectedById}
        pickedUp={pickedUpSet}
        onToggleStop={onToggleStop}
      />

      {/* Dijkstra inspection layer sits above stop pins so the settled vertex stays visible. */}
      {dijkstra && <DijkstraLayers graph={graph} dijkstra={dijkstra} />}

      <Marker position={[graph.start.lat, graph.start.lon]} icon={startIcon} zIndexOffset={700}>
        <Tooltip direction="top" offset={[0, -18]} opacity={0.97}>
          <span className="map-tooltip-title">{graph.start.name}</span>
          <span className="map-tooltip-meta">
            Bus start · snapped {graph.start.snapDistance.toFixed(1)} m
          </span>
        </Tooltip>
      </Marker>

      <Marker
        position={[graph.destination.lat, graph.destination.lon]}
        icon={destIcon}
        zIndexOffset={720}
      >
        <Tooltip direction="top" offset={[0, -20]} opacity={0.97}>
          <span className="map-tooltip-title">{graph.destination.name}</span>
          <span className="map-tooltip-meta">
            Destination · snapped {graph.destination.snapDistance.toFixed(1)} m
          </span>
        </Tooltip>
      </Marker>

      {plan && busCoord && showBus && (
        <Marker position={toLL(busCoord)} icon={busIcon} zIndexOffset={1200}>
          <Tooltip permanent direction="top" offset={[0, -20]} className="bus-tooltip">
            Bus · {onboard}/20
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
