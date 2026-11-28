import { memo, useMemo, useState } from 'react';
import type { Graph, StopInfo } from '../lib/types';
import type { AlgorithmMode, SelectedStop, SolveProgress } from '../lib/route';
import { BUS_CAPACITY, HELD_KARP_HARD_LIMIT, HELD_KARP_MAX_STOPS } from '../config';
import { heldKarpMemoryBytes } from '../lib/heldKarp';
import type { CandidateSet } from '../lib/scenario';
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

export interface PresetScenario {
  id: string;
  name: string;
  description: string;
  seed: number;
  k: number;
  index?: number;
  stopIds: string[];
  passengers: number;
  greedyDistance: number;
  optimalDistance: number;
  gapMeters: number;
  gapPct: number;
  algorithm: string;
  metrics?: Record<string, unknown>;
}

interface SidebarProps {
  graph: Graph;
  selected: SelectedStop[];
  visitOrder: Map<string, number>;
  totalPassengers: number;
  notice: Notice | null;
  error: string | null;
  solving: boolean;
  progress: SolveProgress | null;
  mode: AlgorithmMode;
  hkLimit: number;
  candidates: CandidateSet | null;
  presets: PresetScenario[];
  defaultSeed: number;
  onToggleStop: (stop: StopInfo) => void;
  onPassengers: (id: string, value: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDemo: () => void;
  onRun: () => void;
  onCancel: () => void;
  onModeChange: (mode: AlgorithmMode) => void;
  onHkLimitChange: (value: number) => void;
  onRandom: (k: number, seed: string) => void;
  onPreset: (preset: PresetScenario) => void;
}

const MODE_OPTIONS: { value: AlgorithmMode; title: string; detail: string }[] = [
  {
    value: 'greedy',
    title: 'A · Dijkstra only (greedy nearest stop)',
    detail: 'Greedy nearest stop by real road distance. Any number of stops.',
  },
  {
    value: 'held-karp',
    title: 'B · Dijkstra + Held-Karp (optimized order)',
    detail: 'Exact optimal order, or heuristic above the HK limit.',
  },
  {
    value: 'compare',
    title: 'C · Compare A vs B',
    detail: 'Run both on the same matrix and show the difference.',
  },
];

const PROGRESS_LABEL: Record<SolveProgress['phase'], string> = {
  matrix: 'Building distance matrix',
  greedy: 'Greedy order',
  'held-karp': 'Held-Karp DP',
  heuristic: 'Heuristic search',
  building: 'Stitching route',
};

export const Sidebar = memo(function Sidebar({
  graph,
  selected,
  visitOrder,
  totalPassengers,
  notice,
  error,
  solving,
  progress,
  mode,
  hkLimit,
  candidates,
  presets,
  defaultSeed,
  onToggleStop,
  onPassengers,
  onRemove,
  onClear,
  onDemo,
  onRun,
  onCancel,
  onModeChange,
  onHkLimitChange,
  onRandom,
  onPreset,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('campus');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [randomK, setRandomK] = useState(8);
  const [seedText, setSeedText] = useState(String(defaultSeed));
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const [copied, setCopied] = useState(false);

  const capacityError = totalPassengers > BUS_CAPACITY;
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.stop.id)), [selected]);
  const heuristicFallback = selected.length > hkLimit && mode !== 'greedy';
  const memoryMb = heldKarpMemoryBytes(hkLimit) / 1024 / 1024;
  const preset = presets.find((item) => item.id === presetId) ?? presets[0] ?? null;
  const candidateWarning = randomK > BUS_CAPACITY;

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

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(seedText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

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

      <section className="side-section mode-section">
        <div className="section-heading">
          <h2>Algorithm mode</h2>
          <span className="count-badge">A/B/C</span>
        </div>
        <div className="mode-options" role="radiogroup" aria-label="Algorithm mode">
          {MODE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              role="radio"
              aria-checked={mode === option.value}
              className={`mode-option ${mode === option.value ? 'active' : ''}`}
              onClick={() => onModeChange(option.value)}
            >
              <span className="mode-radio" />
              <span className="mode-copy">
                <strong>{option.title}</strong>
                <em>{option.detail}</em>
              </span>
            </button>
          ))}
        </div>
        {heuristicFallback && (
          <div className="inline-banner info">
            <WarningIcon size={15} />
            <span>
              Exact optimization (Held-Karp) is not available for n &gt; {hkLimit} stops. Using a
              heuristic instead; the result is NOT guaranteed optimal.
            </span>
          </div>
        )}
        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
        >
          <span>Advanced settings</span>
          <em>{advancedOpen ? 'hide' : 'show'}</em>
        </button>
        {advancedOpen && (
          <div className="advanced-panel">
            <label className="advanced-field">
              <span>Held-Karp max stops</span>
              <input
                type="number"
                min={1}
                max={HELD_KARP_HARD_LIMIT}
                value={hkLimit}
                onChange={(event) => onHkLimitChange(Number(event.target.value))}
              />
            </label>
            <p>
              Default from <code>HELD_KARP_MAX_STOPS</code> is {HELD_KARP_MAX_STOPS}. Raising it
              above {HELD_KARP_MAX_STOPS} can be slow and may exhaust browser memory; the DP costs
              O(n²·2ⁿ) time and O(n·2ⁿ) memory (~{memoryMb.toFixed(1)} MB at the current limit).
              The UI accepts at most {HELD_KARP_HARD_LIMIT}.
            </p>
            {hkLimit > HELD_KARP_MAX_STOPS && (
              <div className="inline-banner error">
                <WarningIcon size={15} />
                <span>
                  Warning: Held-Karp above {HELD_KARP_MAX_STOPS} stops may freeze or run out of
                  memory. Cancel is available while a worker is running.
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="side-section run-section">
        <div className="capacity-head">
          <div>
            <h2>Waiting passengers</h2>
            <p>{selected.length} stops selected · no stop-count cap</p>
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

        {solving && (
          <div className="solve-progress" role="status">
            <div className="solve-progress-head">
              <span>{progress ? PROGRESS_LABEL[progress.phase] : 'Working…'}</span>
              <b>{Math.round((progress?.progress ?? 0) * 100)}%</b>
            </div>
            <div className="solve-progress-track">
              <span style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }} />
            </div>
            <div className="solve-progress-foot">
              <em>{progress?.detail ?? 'Running in a Web Worker'}</em>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </div>
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

      <section className="side-section random-section">
        <div className="section-heading">
          <h2>Random scenario</h2>
          <span className="count-badge">{candidates?.stops.length ?? '…'} candidates</span>
        </div>
        <div className="random-controls">
          <label className="random-field">
            <span>Stops (k)</span>
            <input
              type="number"
              min={1}
              max={candidates?.stops.length ?? 999}
              value={randomK}
              onChange={(event) => setRandomK(Math.max(1, Math.round(Number(event.target.value) || 1)))}
            />
          </label>
          <label className="random-field grow">
            <span>Seed</span>
            <input
              type="text"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
              placeholder="Number or text"
            />
          </label>
          <button type="button" className="seed-copy" onClick={copySeed} title="Copy seed">
            {copied ? <CheckIcon size={13} /> : '⧉'}
          </button>
        </div>
        {candidateWarning && (
          <div className="inline-banner error">
            <WarningIcon size={15} />
            <span>
              k = {randomK} needs {randomK} passengers (1 each), above the {BUS_CAPACITY}-passenger
              capacity. The stops will be selected but the run is blocked.
            </span>
          </div>
        )}
        {candidates && randomK > hkLimit && (
          <p className="random-note">
            k &gt; {hkLimit}: Mode B/C will use the heuristic and label it “not proven optimal”.
          </p>
        )}
        <button
          type="button"
          className="outline-button random-button"
          onClick={() => onRandom(randomK, seedText)}
          disabled={!candidates || solving}
        >
          Generate &amp; run with seed
        </button>
        {candidates && (
          <p className="candidate-note">
            {candidates.stops.length} valid stops · {candidates.mergedCount} merged by snapped
            vertex · {candidates.unreachableCount} unreachable excluded.
          </p>
        )}
      </section>

      <section className="side-section preset-section">
        <div className="section-heading">
          <h2>Presets</h2>
          <span className="count-badge">{presets.length}</span>
        </div>
        <label className="preset-select">
          <span>Scenario</span>
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            {presets.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · k={item.k} · gap {item.gapMeters.toFixed(0)} m
              </option>
            ))}
          </select>
        </label>
        {preset && (
          <div className="preset-detail">
            <p>{preset.description}</p>
            <div className="preset-metrics">
              <span>
                Measured gap <b>{fmtMeters(preset.gapMeters)}</b> ({preset.gapPct.toFixed(2)}%)
              </span>
              <span>
                A {fmtMeters(preset.greedyDistance)} · B {fmtMeters(preset.optimalDistance)}
              </span>
              <span>
                seed <code>{preset.seed}</code> · k={preset.k}
              </span>
            </div>
            <button
              type="button"
              className="outline-button"
              onClick={() => onPreset(preset)}
              disabled={solving}
            >
              Load preset &amp; run in Compare mode
            </button>
          </div>
        )}
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
            <span>Pick a stop from the list, click a dot on the map, or generate a random scenario.</span>
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
