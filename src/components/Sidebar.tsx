import { memo, useMemo, useState } from 'react';
import type { Graph, StopInfo } from '../lib/types';
import type { SelectedStop } from '../lib/route';
import { BUS_CAPACITY, MAX_STOPS } from '../config';
import { haversine } from '../lib/geo';
import { fmtMeters } from '../lib/format';
import {
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  FlagIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  StationIcon,
  WarningIcon,
} from './Icons';

type SortMode = 'campus' | 'start' | 'name';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface SidebarProps {
  graph: Graph;
  selected: SelectedStop[];
  visitOrder: Map<string, number>;
  totalPassengers: number;
  notice: Notice | null;
  error: string | null;
  solving: boolean;
  onToggleStop: (stop: StopInfo) => void;
  onPassengers: (id: string, value: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDemo: () => void;
  onRun: () => void;
}

export const Sidebar = memo(function Sidebar({
  graph,
  selected,
  visitOrder,
  totalPassengers,
  notice,
  error,
  solving,
  onToggleStop,
  onPassengers,
  onRemove,
  onClear,
  onDemo,
  onRun,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('campus');
  const capacityError = totalPassengers > BUS_CAPACITY;
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.stop.id)), [selected]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of graph.stops) counts.set(stop.name, (counts.get(stop.name) ?? 0) + 1);
    return counts;
  }, [graph.stops]);

  const stopRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? graph.stops.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.ref ?? '').toLowerCase().includes(q) ||
            (s.routeRef ?? '').toLowerCase().includes(q),
        )
      : graph.stops;
    const rows = filtered.map((stop) => ({
      stop,
      campus: haversine([stop.lon, stop.lat], [graph.destination.lon, graph.destination.lat]),
      start: haversine([stop.lon, stop.lat], [graph.start.lon, graph.start.lat]),
    }));
    if (sort === 'campus') rows.sort((a, b) => a.campus - b.campus);
    else if (sort === 'start') rows.sort((a, b) => a.start - b.start);
    else rows.sort((a, b) => a.stop.name.localeCompare(b.stop.name, 'ko'));
    return rows;
  }, [graph.stops, graph.destination, graph.start, query, sort]);

  const runHint =
    selected.length === 0
      ? 'Choose at least one waiting stop.'
      : capacityError
        ? `Over capacity by ${totalPassengers - BUS_CAPACITY}. Remove passengers to run.`
        : null;

  return (
    <aside className="sidebar">
      <section className="side-section trip-section">
        <div className="section-heading">
          <h2>Trip endpoints</h2>
          <span className="fixed-badge">fixed</span>
        </div>
        <div className="trip-endpoint">
          <span className="endpoint-icon start">
            <StationIcon size={16} />
          </span>
          <div className="endpoint-copy">
            <strong>{graph.start.name}</strong>
            <span>Bus start · snapped {graph.start.snapDistance.toFixed(1)} m</span>
          </div>
        </div>
        <div className="trip-connector" aria-hidden="true">
          <span />
          <ArrowRightIcon size={13} />
        </div>
        <div className="trip-endpoint">
          <span className="endpoint-icon dest">
            <FlagIcon size={16} />
          </span>
          <div className="endpoint-copy">
            <strong>{graph.destination.name}</strong>
            <span>Destination · snapped {graph.destination.snapDistance.toFixed(1)} m</span>
          </div>
        </div>
      </section>

      {notice && (
        <div className={`inline-banner ${notice.kind}`} role="status">
          <WarningIcon size={15} />
          <span>{notice.text}</span>
        </div>
      )}

      <section className="side-section run-section">
        <div className="capacity-head">
          <div>
            <h2>Waiting passengers</h2>
            <p>
              {selected.length}/{MAX_STOPS} stops selected
            </p>
          </div>
          <div className={`capacity-value ${capacityError ? 'over' : ''}`}>
            <b>{totalPassengers}</b>
            <span>/ {BUS_CAPACITY}</span>
          </div>
        </div>
        <div className={`capacity-meter ${capacityError ? 'over' : ''}`} aria-hidden="true">
          {Array.from({ length: BUS_CAPACITY }, (_, i) => (
            <span key={i} className={i < totalPassengers ? 'filled' : ''} />
          ))}
        </div>

        {capacityError && (
          <div className="inline-banner error">
            <WarningIcon size={15} />
            <span>
              Total passengers exceed the bus capacity by {totalPassengers - BUS_CAPACITY}.
            </span>
          </div>
        )}
        {error && (
          <div className="inline-banner error">
            <WarningIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          className={`run-button ${solving ? 'is-solving' : ''}`}
          onClick={onRun}
          disabled={Boolean(runHint) || solving}
        >
          <SparkIcon size={17} />
          <span>{solving ? 'Solving…' : 'Run optimisation'}</span>
          {!solving && <kbd>↵</kbd>}
        </button>
        {runHint && <p className="run-hint">{runHint}</p>}
      </section>

      <section className="side-section selected-section">
        <div className="section-heading">
          <h2>Selected stops</h2>
          <div className="heading-actions">
            <button type="button" className="text-button" onClick={onDemo}>
              Demo
            </button>
            <button
              type="button"
              className="text-button muted"
              onClick={onClear}
              disabled={selected.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {selected.length === 0 ? (
          <div className="selected-empty">
            <span className="empty-pin" />
            <p>No stops selected yet.</p>
            <span>Pick a stop from the list or click a dot on the map.</span>
          </div>
        ) : (
          <div className="selected-list">
            {selected.map((item, index) => {
              const order = visitOrder.get(item.stop.id) ?? index + 1;
              return (
                <div className="selected-row" key={item.stop.id}>
                  <span className="visit-index">{order}</span>
                  <div className="selected-copy">
                    <strong title={item.stop.name}>{item.stop.name}</strong>
                    <span>
                      snap {fmtMeters(item.stop.snapDistance)}
                      {item.stop.routeRef ? ` · ${item.stop.routeRef}` : ''}
                    </span>
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => onPassengers(item.stop.id, item.passengers - 1)}
                      aria-label={`Remove one passenger at ${item.stop.name}`}
                      disabled={item.passengers <= 1}
                    >
                      <MinusIcon size={12} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={BUS_CAPACITY}
                      value={item.passengers}
                      onChange={(e) => onPassengers(item.stop.id, Number(e.target.value))}
                      aria-label={`Passengers at ${item.stop.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => onPassengers(item.stop.id, item.passengers + 1)}
                      aria-label={`Add one passenger at ${item.stop.name}`}
                    >
                      <PlusIcon size={12} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="remove-stop"
                    onClick={() => onRemove(item.stop.id)}
                    aria-label={`Remove ${item.stop.name}`}
                  >
                    <CloseIcon size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="side-section browser-section">
        <div className="section-heading">
          <h2>Bus stops</h2>
          <span className="count-badge">{graph.stops.length}</span>
        </div>
        <div className="browser-tools">
          <label className="search-field">
            <SearchIcon size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stop name or route"
              aria-label="Search bus stops"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <CloseIcon size={12} />
              </button>
            )}
          </label>
          <label className="sort-field">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="campus">Near gate</option>
              <option value="start">Near start</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </div>

        <div className="stop-list" role="list">
          {stopRows.length === 0 && <p className="list-empty">No stops match “{query}”.</p>}
          {stopRows.map(({ stop, campus }) => {
            const isSelected = selectedIds.has(stop.id);
            const count = duplicateNames.get(stop.name) ?? 1;
            return (
              <button
                type="button"
                key={stop.id}
                className={`stop-row ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onToggleStop(stop)}
                title={`${stop.name}${
                  count > 1 ? ' — another stop shares this name (likely the opposite side of the road)' : ''
                }`}
              >
                <span className="stop-check">
                  {isSelected ? <CheckIcon size={12} /> : <PlusIcon size={12} />}
                </span>
                <span className="stop-copy">
                  <span className="stop-name">
                    {stop.name}
                    {count > 1 && <em className="pair-badge">{count}×</em>}
                  </span>
                  <span className="stop-meta">
                    {fmtMeters(campus)} from gate
                    {stop.routeRef ? ` · ${stop.routeRef}` : ''}
                  </span>
                </span>
                <span className="stop-snap">{stop.snapDistance.toFixed(0)} m</span>
              </button>
            );
          })}
        </div>
        <p className="browser-note">
          Stops are snapped to the nearest drivable vertex. Distances shown in the right column are
          the offset from the OSM platform point.
        </p>
      </section>
    </aside>
  );
});
