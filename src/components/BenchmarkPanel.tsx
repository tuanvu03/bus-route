import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph, StopInfo } from '../lib/types';
import type { CandidateSet } from '../lib/scenario';
import {
  benchmarkToCsv,
  type BenchmarkConfig,
  type BenchmarkProgress,
  type BenchmarkResult,
  type KSummary,
  type ScenarioResult,
} from '../lib/benchmark';
import {
  DEFAULT_BENCHMARK_SCENARIOS,
  DEFAULT_SCENARIO_SEED,
  HELD_KARP_HARD_LIMIT,
  HELD_KARP_MAX_STOPS,
} from '../config';
import { fmtMeters } from '../lib/format';
import { parseSeed } from '../lib/random';
import { ArrowRightIcon, CheckIcon, WarningIcon } from './Icons';

export interface BenchmarkLoadRequest {
  k: number;
  baseSeed: number;
  seed: number;
  passengers: number;
  index: number;
  stopIds?: string[];
}

interface BenchmarkPanelProps {
  graph: Graph;
  candidates: CandidateSet | null;
  onLoadScenario: (request: BenchmarkLoadRequest) => void;
}

interface WorkerMessage {
  type: 'ready' | 'progress' | 'summary' | 'done' | 'error';
  progress?: BenchmarkProgress;
  summary?: KSummary;
  result?: BenchmarkResult;
  message?: string;
}

const PHASE_LABEL: Record<BenchmarkProgress['phase'], string> = {
  cache: 'Caching Dijkstra per source vertex',
  scenarios: 'Running greedy + optimal scenarios',
  summary: 'Summarising',
};

function parseKValues(text: string): number[] {
  const out = new Set<number>();
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Enter at least one k value');
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*(?:\.\.|-|–)\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < from) throw new Error(`Invalid k range "${part}"`);
      for (let k = from; k <= to; k++) out.add(k);
      continue;
    }
    if (!/^\d+$/.test(part)) throw new Error(`Invalid k value "${part}"`);
    const value = Number(part);
    if (value < 1) throw new Error('k values must be at least 1');
    out.add(value);
  }
  return [...out].sort((a, b) => a - b);
}

export function BenchmarkPanel({ graph: _graph, candidates, onLoadScenario }: BenchmarkPanelProps) {
  const [kInput, setKInput] = useState('2..15');
  const [scenariosPerK, setScenariosPerK] = useState(DEFAULT_BENCHMARK_SCENARIOS);
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SCENARIO_SEED));
  const [passengers, setPassengers] = useState(1);
  const [hkLimit, setHkLimit] = useState(HELD_KARP_MAX_STOPS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
  const [summaries, setSummaries] = useState<KSummary[]>([]);
  const [lastConfig, setLastConfig] = useState<BenchmarkConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeK, setActiveK] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [cacheMs, setCacheMs] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const serializedGraph = useCallback(
    () => ({
      meta: _graph.meta,
      vertices: Array.from(_graph.coords),
      adj: _graph.adj.map((list) => list.map(([to, weight]) => [to, weight])),
      stops: _graph.stops,
      start: _graph.start,
      destination: _graph.destination,
      roads: _graph.roads,
    }),
    [_graph],
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress(null);
    setError('Benchmark cancelled. Partial results are kept.');
  }, []);

  const run = useCallback(() => {
    if (!candidates) return;
    let kValues: number[];
    try {
      kValues = parseKValues(kInput);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      return;
    }
    if (kValues.some((k) => k > candidates.stops.length)) {
      setError(`k cannot exceed the ${candidates.stops.length} candidate stops.`);
      return;
    }
    if (scenariosPerK < 1) {
      setError('Scenarios per k must be at least 1.');
      return;
    }

    const config: BenchmarkConfig = {
      kValues,
      scenariosPerK: Math.round(scenariosPerK),
      baseSeed: parseSeed(seedInput),
      passengersPerStop: Math.max(1, Math.round(passengers)),
      hkLimit: Math.max(1, Math.min(HELD_KARP_HARD_LIMIT, Math.round(hkLimit))),
    };

    workerRef.current?.terminate();
    setSummaries([]);
    setLastConfig(config);
    setError(null);
    setRunning(true);
    setTotalMs(null);
    setCacheMs(null);
    setProgress({ phase: 'cache', progress: 0, detail: 'Starting worker' });
    setActiveK(kValues[0] ?? null);

    if (typeof Worker === 'undefined') {
      setError('Web Workers are not available in this environment.');
      setRunning(false);
      return;
    }

    const worker = new Worker(new URL('../workers/benchmark.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress' && message.progress) {
        setProgress(message.progress);
        return;
      }
      if (message.type === 'summary' && message.summary) {
        const summary = message.summary;
        setSummaries((current) => {
          const next = current.filter((item) => item.k !== summary.k);
          next.push(summary);
          next.sort((a, b) => a.k - b.k);
          return next;
        });
        if (summary.violations > 0) {
          console.error(
            `[benchmark] k=${summary.k}: ${summary.violations} scenarios violated optimal <= greedy`,
            summary.scenarios.filter((scenario) => scenario.bug),
          );
        }
        return;
      }
      if (message.type === 'done' && message.result) {
        setRunning(false);
        setProgress(null);
        setTotalMs(message.result.totalMs);
        setCacheMs(message.result.cacheMs);
        if (message.result.violations > 0) {
          setError(
            `Correctness assertion failed in ${message.result.violations} scenario(s). See the browser console and the flagged rows.`,
          );
        }
        return;
      }
      if (message.type === 'error') {
        setRunning(false);
        setProgress(null);
        setError(message.message ?? 'Benchmark worker failed');
      }
    };
    worker.onerror = (event) => {
      setRunning(false);
      setProgress(null);
      setError(event.message || 'Benchmark worker failed');
    };
    worker.postMessage({ type: 'init', graph: serializedGraph() });
    worker.postMessage({ type: 'run', candidates: candidates.stops, config });
    workerRef.current = worker;
  }, [candidates, hkLimit, kInput, passengers, scenariosPerK, seedInput, serializedGraph]);

  const worstScenario = useCallback((summary: KSummary): ScenarioResult | null => {
    const valid = summary.scenarios.filter((scenario) => !scenario.skipped);
    if (valid.length === 0) return null;
    return valid.reduce((best, scenario) =>
      scenario.gapMeters > best.gapMeters ? scenario : best,
    );
  }, []);

  const loadScenario = useCallback(
    (scenario: ScenarioResult) => {
      onLoadScenario({
        k: scenario.k,
        baseSeed: lastConfig?.baseSeed ?? scenario.baseSeed,
        seed: scenario.seed,
        passengers: lastConfig?.passengersPerStop ?? 1,
        index: scenario.index,
        stopIds: scenario.stopIds,
      });
    },
    [lastConfig, onLoadScenario],
  );

  const download = useCallback(
    (format: 'csv' | 'json') => {
      if (!lastConfig) return;
      const result: BenchmarkResult = {
        config: lastConfig,
        summaries,
        cacheMs: cacheMs ?? 0,
        totalMs: totalMs ?? 0,
        skipped: summaries.reduce((sum, summary) => sum + summary.skipped, 0),
        violations: summaries.reduce((sum, summary) => sum + summary.violations, 0),
      };
      const content =
        format === 'csv' ? benchmarkToCsv(result) : JSON.stringify(result, null, 2);
      const blob = new Blob([content], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bus-way-benchmark-${lastConfig.baseSeed}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [cacheMs, lastConfig, summaries, totalMs],
  );

  const activeSummary = activeK === null ? null : summaries.find((item) => item.k === activeK) ?? null;
  const violations = summaries.reduce((sum, summary) => sum + summary.violations, 0);
  const skipped = summaries.reduce((sum, summary) => sum + summary.skipped, 0);

  const overall = useMemo(() => {
    if (summaries.length === 0) return null;
    return {
      scenarios: summaries.reduce((sum, summary) => sum + summary.count, 0),
      meanRate:
        summaries.reduce((sum, summary) => sum + summary.greedyOptimalRate, 0) /
        summaries.length,
      meanGap:
        summaries.reduce((sum, summary) => sum + summary.meanGap, 0) / summaries.length,
    };
  }, [summaries]);

  return (
    <div className="benchmark-page">
      <header className="benchmark-head">
        <div>
          <span className="section-kicker">Benchmark on this map</span>
          <h1>How much does Held-Karp beat greedy?</h1>
          <p>
            The candidate stops and the single-source Dijkstra cache are fixed once. Every scenario
            reuses that cache, so no Dijkstra search is repeated per scenario.
          </p>
        </div>
        <div className="benchmark-head-stats">
          <div>
            <b>{candidates?.stops.length ?? '…'}</b>
            <span>candidate stops</span>
          </div>
          <div>
            <b>{candidates?.mergedCount ?? '…'}</b>
            <span>merged by vertex</span>
          </div>
          <div>
            <b>{candidates?.unreachableCount ?? '…'}</b>
            <span>unreachable excluded</span>
          </div>
        </div>
      </header>

      <section className="benchmark-config">
        <label>
          <span>k values</span>
          <input value={kInput} onChange={(event) => setKInput(event.target.value)} placeholder="2..15" />
        </label>
        <label>
          <span>Scenarios / k</span>
          <input
            type="number"
            min={1}
            value={scenariosPerK}
            onChange={(event) => setScenariosPerK(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Base seed</span>
          <input value={seedInput} onChange={(event) => setSeedInput(event.target.value)} />
        </label>
        <label>
          <span>Passengers / stop</span>
          <input
            type="number"
            min={1}
            value={passengers}
            onChange={(event) => setPassengers(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Held-Karp limit</span>
          <input
            type="number"
            min={1}
            max={HELD_KARP_HARD_LIMIT}
            value={hkLimit}
            onChange={(event) =>
              setHkLimit(
                Math.max(1, Math.min(HELD_KARP_HARD_LIMIT, Math.round(Number(event.target.value) || 1))),
              )
            }
          />
        </label>
        <div className="benchmark-run">
          <button type="button" className="run-button" onClick={run} disabled={running || !candidates}>
            <span>{running ? 'Running…' : 'Run benchmark'}</span>
          </button>
          {running && (
            <button type="button" className="outline-button" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </section>

      {progress && running && (
        <section className="benchmark-progress" role="status">
          <div className="solve-progress-head">
            <span>{PHASE_LABEL[progress.phase]}</span>
            <b>{Math.round(progress.progress * 100)}%</b>
          </div>
          <div className="solve-progress-track">
            <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
          </div>
          <div className="solve-progress-foot">
            <em>{progress.detail ?? ''}</em>
            {progress.totalSources ? (
              <span>
                cached sources {progress.cachedSources}/{progress.totalSources}
              </span>
            ) : null}
          </div>
        </section>
      )}

      {error && (
        <div className="inline-banner error">
          <WarningIcon size={15} />
          <span>{error}</span>
        </div>
      )}

      {violations > 0 && (
        <div className="inline-banner error">
          <WarningIcon size={15} />
          <span>
            BUG: {violations} exact solve(s) were longer than greedy. Flagged rows are marked in the
            scenario table.
          </span>
        </div>
      )}

      {summaries.length > 0 && (
        <>
          <div className="benchmark-summary-line">
            <span>
              <CheckIcon size={13} /> {overall?.scenarios ?? 0} scenarios · greedy optimal{' '}
              {(overall?.meanRate ?? 0).toFixed(1)}% · mean gap {fmtMeters(overall?.meanGap ?? 0)}
            </span>
            <span>
              cache {cacheMs !== null ? `${cacheMs.toFixed(0)} ms` : '—'} · total{' '}
              {totalMs !== null ? `${(totalMs / 1000).toFixed(1)} s` : running ? 'running' : '—'} ·
              skipped {skipped} · bugs {violations}
            </span>
            <div className="benchmark-export">
              <button type="button" onClick={() => download('csv')} disabled={!lastConfig}>
                Export CSV
              </button>
              <button type="button" onClick={() => download('json')} disabled={!lastConfig}>
                Export JSON
              </button>
            </div>
          </div>

          <div className="benchmark-charts">
            <GapChart summaries={summaries} />
            <RateChart summaries={summaries} />
          </div>

          <div className="benchmark-table-wrap">
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>k</th>
                  <th>Solver</th>
                  <th>Greedy optimal</th>
                  <th>Mean gap</th>
                  <th>Median</th>
                  <th>p90</th>
                  <th>Max</th>
                  <th>Greedy ms</th>
                  <th>Solver ms</th>
                  <th>Skipped</th>
                  <th>Bugs</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr
                    key={summary.k}
                    className={activeK === summary.k ? 'active' : ''}
                    onClick={() => setActiveK(summary.k)}
                  >
                    <td><b>{summary.k}</b></td>
                    <td>
                      <span className={`algo-pill ${summary.algorithm}`}>
                        {summary.algorithm === 'exact' ? 'Exact' : 'Heuristic (not proven optimal)'}
                      </span>
                    </td>
                    <td>{summary.greedyOptimalRate.toFixed(1)}%</td>
                    <td>
                      {fmtMeters(summary.meanGap)}
                      <em>{summary.meanGapPct.toFixed(2)}%</em>
                    </td>
                    <td>
                      {fmtMeters(summary.medianGap)}
                      <em>{summary.medianGapPct.toFixed(2)}%</em>
                    </td>
                    <td>
                      {fmtMeters(summary.p90Gap)}
                      <em>{summary.p90GapPct.toFixed(2)}%</em>
                    </td>
                    <td>
                      {fmtMeters(summary.maxGap)}
                      <em>{summary.maxGapPct.toFixed(2)}%</em>
                    </td>
                    <td>{summary.meanGreedyMs.toFixed(2)}</td>
                    <td>{summary.meanOptimalMs.toFixed(2)}</td>
                    <td>{summary.skipped}</td>
                    <td className={summary.violations > 0 ? 'bug-cell' : ''}>
                      {summary.violations}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="worst-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const worst = worstScenario(summary);
                          if (worst) loadScenario(worst);
                        }}
                      >
                        Show worst scenario
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeSummary && (
            <div className="scenario-panel">
              <div className="subsection-heading">
                <h3>Scenarios for k = {activeSummary.k}</h3>
                <span>
                  {activeSummary.count} valid · {activeSummary.skipped} skipped · click any row to
                  load it into Mode C
                </span>
              </div>
              <div className="scenario-table-wrap">
                <table className="scenario-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Seed</th>
                      <th>Greedy</th>
                      <th>Optimal</th>
                      <th>Gap</th>
                      <th>Gap %</th>
                      <th>Algorithm</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {activeSummary.scenarios.map((scenario) => (
                      <tr
                        key={`${scenario.k}-${scenario.index}`}
                        className={`${scenario.bug ? 'bug-row' : ''} ${scenario.skipped ? 'skipped-row' : ''}`}
                        onClick={() => !scenario.skipped && loadScenario(scenario)}
                        title="Load this scenario into the simulator in Mode C"
                      >
                        <td>{scenario.index}</td>
                        <td><code>{scenario.seed}</code></td>
                        <td>{Number.isFinite(scenario.greedyDistance) ? fmtMeters(scenario.greedyDistance) : '—'}</td>
                        <td>{Number.isFinite(scenario.optimalDistance) ? fmtMeters(scenario.optimalDistance) : '—'}</td>
                        <td>{Number.isFinite(scenario.gapMeters) ? fmtMeters(scenario.gapMeters) : '—'}</td>
                        <td>{scenario.gapPct.toFixed(2)}%</td>
                        <td>
                          {scenario.algorithm === 'exact'
                            ? 'Exact'
                            : 'Heuristic (not proven optimal)'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="load-button"
                            disabled={scenario.skipped}
                            onClick={(event) => {
                              event.stopPropagation();
                              loadScenario(scenario);
                            }}
                          >
                            Load this scenario <ArrowRightIcon size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {summaries.length === 0 && !running && (
        <div className="benchmark-empty">
          <p>
            Default run: k = 2…15, 200 scenarios per k. The worker caches one Dijkstra result per
            source vertex, then reuses it for every scenario. Rerunning with the same seed reproduces
            every row; click a scenario to load it into the simulator.
          </p>
        </div>
      )}
    </div>
  );
}

function GapChart({ summaries }: { summaries: KSummary[] }) {
  const width = 560;
  const height = 230;
  const margin = { top: 20, right: 18, bottom: 34, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxY = Math.max(1, ...summaries.map((summary) => Math.max(summary.p90GapPct, summary.meanGapPct))) * 1.15;
  const x = (index: number) =>
    margin.left + (summaries.length <= 1 ? innerW / 2 : (index / (summaries.length - 1)) * innerW);
  const y = (value: number) => margin.top + innerH - (value / maxY) * innerH;
  const meanPath = summaries.map((summary, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(summary.meanGapPct)}`).join(' ');
  const p90Path = summaries.map((summary, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(summary.p90GapPct)}`).join(' ');
  const bandPath =
    summaries.length > 0
      ? `${summaries.map((summary, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(summary.meanGapPct)}`).join(' ')} ` +
        `${[...summaries].reverse().map((summary, i) => `L${x(summaries.length - 1 - i)},${y(summary.p90GapPct)}`).join(' ')} Z`
      : '';

  return (
    <div className="chart-card">
      <div className="chart-head">
        <strong>Gap % over optimal vs k</strong>
        <span>mean line · p90 band</span>
      </div>
      {summaries.length === 0 ? (
        <p className="chart-empty">No results yet.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gap percentage versus k">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = maxY * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y(value)}
                  y2={y(value)}
                  className="chart-grid"
                />
                <text x={margin.left - 8} y={y(value) + 4} textAnchor="end" className="chart-axis">
                  {value.toFixed(1)}%
                </text>
              </g>
            );
          })}
          {bandPath && <path d={bandPath} className="chart-band" />}
          <path d={p90Path} className="chart-line p90" />
          <path d={meanPath} className="chart-line mean" />
          {summaries.map((summary, i) => (
            <g key={summary.k}>
              <circle cx={x(i)} cy={y(summary.meanGapPct)} r={3} className="chart-dot mean">
                <title>
                  k={summary.k}: mean {summary.meanGapPct.toFixed(2)}%, p90{' '}
                  {summary.p90GapPct.toFixed(2)}%
                </title>
              </circle>
              <text x={x(i)} y={height - 12} textAnchor="middle" className="chart-axis">
                {summary.k}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function RateChart({ summaries }: { summaries: KSummary[] }) {
  const width = 560;
  const height = 230;
  const margin = { top: 20, right: 18, bottom: 34, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + (summaries.length <= 1 ? innerW / 2 : (index / (summaries.length - 1)) * innerW);
  const y = (value: number) => margin.top + innerH - (value / 100) * innerH;
  const path = summaries
    .map((summary, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(summary.greedyOptimalRate)}`)
    .join(' ');

  return (
    <div className="chart-card">
      <div className="chart-head">
        <strong>Greedy optimal rate vs k</strong>
        <span>within 0.5 m</span>
      </div>
      {summaries.length === 0 ? (
        <p className="chart-empty">No results yet.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Greedy optimal rate versus k">
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(value)}
                y2={y(value)}
                className="chart-grid"
              />
              <text x={margin.left - 8} y={y(value) + 4} textAnchor="end" className="chart-axis">
                {value}%
              </text>
            </g>
          ))}
          <path d={path} className="chart-line rate" />
          {summaries.map((summary, i) => (
            <g key={summary.k}>
              <circle cx={x(i)} cy={y(summary.greedyOptimalRate)} r={3} className="chart-dot rate">
                <title>
                  k={summary.k}: {summary.greedyOptimalRate.toFixed(1)}% greedy optimal
                </title>
              </circle>
              <text x={x(i)} y={height - 12} textAnchor="middle" className="chart-axis">
                {summary.k}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
