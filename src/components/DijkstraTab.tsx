import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from '../lib/types';
import { vertexCoord, vertexCount } from '../lib/types';
import type { RoutePlan } from '../lib/route';
import { frontierAtStep, reconstructPath } from '../lib/dijkstra';
import { pointLabel } from '../lib/labels';
import { fmtMeters, fmtNumber } from '../lib/format';
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  WarningIcon,
} from './Icons';

interface DijkstraTabProps {
  graph: Graph;
  plan: RoutePlan | null;
  leg: [number, number] | null;
  step: number;
  onLegChange: (from: number, to: number) => void;
  onStepChange: (step: number) => void;
}

const PAGE_SIZES = [25, 50, 100];

export function DijkstraTab({
  graph,
  plan,
  leg,
  step,
  onLegChange,
  onStepChange,
}: DijkstraTabProps) {
  const [updatedOnly, setUpdatedOnly] = useState(false);
  const [pathOnly, setPathOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(20);

  const run = plan && leg ? plan.runs[leg[0]] ?? null : null;
  const targetIndex = leg ? leg[1] : null;
  const target = plan && targetIndex !== null ? plan.points[targetIndex] : null;
  const maxStep = run ? run.steps.length : 0;
  const stepClamped = Math.max(0, Math.min(step, maxStep));

  const path = useMemo(() => {
    if (!run || !target) return null;
    return reconstructPath(run, target.vertex);
  }, [run, target]);

  const pathSet = useMemo(() => new Set(path ?? []), [path]);
  const pathDistance = run && target ? run.dist[target.vertex] : Infinity;

  const frontier = useMemo(() => {
    if (!run) return null;
    return frontierAtStep(graph.adj, vertexCount(graph), run.source, run.steps, stepClamped);
  }, [graph.adj, run, stepClamped]);

  const currentStep = stepClamped > 0 && run ? run.steps[stepClamped - 1] : null;

  const updatedCount = useMemo(
    () => (run ? run.steps.filter((s) => s.relaxed.some((r) => r.updated)).length : 0),
    [run],
  );
  const pathCount = useMemo(
    () => (run ? run.steps.filter((s) => pathSet.has(s.vertex)).length : 0),
    [run, pathSet],
  );

  const filtered = useMemo(() => {
    if (!run) return [];
    let rows = run.steps;
    if (updatedOnly) rows = rows.filter((s) => s.relaxed.some((r) => r.updated));
    if (pathOnly) rows = rows.filter((s) => pathSet.has(s.vertex));
    return rows;
  }, [run, updatedOnly, pathOnly, pathSet]);

  useEffect(() => {
    setPage(0);
  }, [updatedOnly, pathOnly, pageSize]);

  useEffect(() => {
    if (!filtered.length) return;
    const index = filtered.findIndex((row) => row.step === stepClamped);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [stepClamped, filtered, pageSize]);

  const stepRef = useRef(stepClamped);
  stepRef.current = stepClamped;
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = filteredRef.current.find((row) => row.step > stepRef.current);
      if (!next) {
        setPlaying(false);
        return;
      }
      onStepChange(next.step);
    }, Math.max(20, 1000 / rate));
    return () => window.clearInterval(id);
  }, [playing, rate, onStepChange]);

  if (!plan) {
    return (
      <div className="dijkstra-tab">
        <div className="empty-panel">
          <span className="empty-panel-icon">D</span>
          <h3>No run to inspect</h3>
          <p>
            Run the optimiser first. The inspector can then replay Dijkstra from any key point to
            any other key point, settlement by settlement.
          </p>
        </div>
      </div>
    );
  }

  if (!leg || !run || !target) {
    return (
      <div className="dijkstra-tab">
        <div className="empty-panel">
          <span className="empty-panel-icon">D</span>
          <h3>Choose a leg</h3>
          <p>Select a leg below to open its Dijkstra log.</p>
          <div className="leg-chips">
            {plan.legs.map((l, i) => (
              <button
                key={i}
                type="button"
                className="leg-chip"
                onClick={() => onLegChange(l.from, l.to)}
              >
                <i style={{ background: l.color }} />
                {pointLabel(l.from, plan.points.length)} → {pointLabel(l.to, plan.points.length)}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const n = plan.points.length;
  const activeLeg = plan.legs.findIndex((l) => l.from === leg[0] && l.to === leg[1]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const firstRow = filtered.length === 0 ? 0 : safePage * pageSize + 1;
  const lastRow = Math.min(filtered.length, (safePage + 1) * pageSize);
  const nextStep = filtered.find((row) => row.step > stepClamped)?.step ?? null;
  const prevStep =
    [...filtered].reverse().find((row) => row.step < stepClamped && row.step > 0)?.step ?? null;
  const currentRowVisible = filtered.some(
    (row) => row.step === stepClamped && row.step >= firstRow && row.step <= lastRow,
  );

  const setStep = (value: number) => {
    setPlaying(false);
    onStepChange(Math.max(0, Math.min(maxStep, value)));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (stepClamped >= maxStep) onStepChange(0);
    setPlaying(true);
  };

  return (
    <div className="dijkstra-tab">
      <div className="dijkstra-head">
        <div className="dijkstra-title">
          <span className="section-kicker">Dijkstra run</span>
          <h3>
            {pointLabel(leg[0], n)} → {pointLabel(leg[1], n)}
          </h3>
        </div>
        <span className={`run-state ${stepClamped >= maxStep ? 'done' : ''}`}>
          {stepClamped === 0
            ? 'initial queue'
            : stepClamped >= maxStep
              ? 'search complete'
              : 'searching'}
        </span>
      </div>

      <div className="leg-picker">
        <div className="leg-chips route-chips">
          {plan.legs.map((l, i) => {
            const active = l.from === leg[0] && l.to === leg[1];
            return (
              <button
                type="button"
                key={i}
                className={`leg-chip ${active ? 'active' : ''}`}
                onClick={() => onLegChange(l.from, l.to)}
                title={`${plan.points[l.from].name} → ${plan.points[l.to].name}`}
              >
                <i style={{ background: l.color }} />
                {pointLabel(l.from, n)} → {pointLabel(l.to, n)}
                <em>{fmtMeters(l.distance)}</em>
              </button>
            );
          })}
        </div>
        <div className="leg-selects">
          <label>
            <span>from</span>
            <select
              value={leg[0]}
              onChange={(e) => onLegChange(Number(e.target.value), leg[1])}
            >
              {plan.points.map((point, i) => (
                <option value={i} key={i}>
                  {pointLabel(i, n)} · {point.name}
                </option>
              ))}
            </select>
          </label>
          <ArrowRightIcon size={14} />
          <label>
            <span>to</span>
            <select
              value={leg[1]}
              onChange={(e) => onLegChange(leg[0], Number(e.target.value))}
            >
              {plan.points.map((point, i) => (
                <option value={i} key={i}>
                  {pointLabel(i, n)} · {point.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="path-result">
        <div className="path-result-main">
          <span className="section-kicker">
            {path ? 'Shortest path' : 'Unreachable'}
          </span>
          <strong>
            {path ? fmtMeters(pathDistance) : 'No directed path'}
            <span>{path ? `${fmtNumber(path.length)} vertices` : 'target is not reachable'}</span>
          </strong>
        </div>
        {path ? (
          <span className="path-pill">
            <CheckIcon size={12} /> d({pointLabel(leg[0], n)},{pointLabel(leg[1], n)}) ={' '}
            {pathDistance.toFixed(1)} m
          </span>
        ) : (
          <span className="path-pill danger">
            <WarningIcon size={12} /> one-way restrictions
          </span>
        )}
      </div>

      {path && path.length > 1 && (
        <details className="path-details">
          <summary>Show the {path.length}-vertex path</summary>
          <div className="vertex-sequence">
            {path.map((v, i) => {
              const c = vertexCoord(graph, v);
              return (
                <span className="vertex-chip" key={i} title={`${c[0].toFixed(7)}, ${c[1].toFixed(7)}`}>
                  {i === 0 && <em>S</em>}
                  v{v}
                  {i === path.length - 1 && <em>T</em>}
                </span>
              );
            })}
          </div>
        </details>
      )}

      <div className="step-stats">
        <div>
          <span>Settled</span>
          <b>{fmtNumber(stepClamped)}<em>/{fmtNumber(maxStep)}</em></b>
        </div>
        <div>
          <span>Frontier</span>
          <b>{frontier ? fmtNumber(frontier.entries.length) : '0'}</b>
        </div>
        <div>
          <span>Updates here</span>
          <b>{currentStep ? currentStep.relaxed.filter((r) => r.updated).length : 0}</b>
        </div>
        <div>
          <span>Total updates</span>
          <b>{fmtNumber(run.updateCount)}</b>
        </div>
      </div>

      <div className="step-controls">
        <div className="step-buttons">
          <button
            type="button"
            className="step-btn"
            onClick={() => setStep(prevStep ?? 0)}
            disabled={prevStep === null}
            aria-label="Previous step"
          >
            <ChevronLeftIcon size={15} />
          </button>
          <button
            type="button"
            className="step-btn play"
            onClick={togglePlay}
            aria-label={playing ? 'Pause stepping' : 'Play stepping'}
          >
            {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          </button>
          <button
            type="button"
            className="step-btn"
            onClick={() => nextStep !== null && setStep(nextStep)}
            disabled={nextStep === null}
            aria-label="Next step"
          >
            <ChevronRightIcon size={15} />
          </button>
          <button
            type="button"
            className="step-btn"
            onClick={() => setStep(maxStep)}
            aria-label="Jump to end"
            title="Jump to end"
          >
            <span className="end-glyph">⇥</span>
          </button>
          <button
            type="button"
            className="step-btn"
            onClick={() => setStep(0)}
            aria-label="Reset to initial queue"
            title="Reset"
          >
            <ResetIcon size={14} />
          </button>
        </div>
        <div className="step-readout">
          <b>{fmtNumber(stepClamped)}</b>
          <span>/ {fmtNumber(maxStep)} settled</span>
        </div>
        <div className="step-rate">
          <span>steps/s</span>
          {[10, 20, 60].map((value) => (
            <button
              type="button"
              key={value}
              className={rate === value ? 'active' : ''}
              onClick={() => setRate(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <input
        className="step-slider"
        type="range"
        min={0}
        max={Math.max(0, maxStep)}
        value={stepClamped}
        onChange={(e) => setStep(Number(e.target.value))}
        aria-label="Dijkstra settlement step"
      />

      <div className="frontier-card">
        <div className="subsection-heading">
          <h3>Frontier snapshot</h3>
          <span>
            {frontier?.entries.length ?? 0} queued
            {frontier && frontier.staleCount > 0 ? ` · ${frontier.staleCount} stale` : ''}
          </span>
        </div>
        {frontier && frontier.entries.length === 0 ? (
          <p className="frontier-empty">Queue is empty — every reachable vertex has been settled.</p>
        ) : (
          <div className="frontier-list">
            {frontier?.entries.slice(0, 8).map((entry, i) => {
              const c = vertexCoord(graph, entry.vertex);
              return (
                <div className="frontier-row" key={entry.vertex}>
                  <span className="frontier-rank">{i + 1}</span>
                  <span className="frontier-vertex">
                    v{entry.vertex}
                    <em>{c[0].toFixed(5)}, {c[1].toFixed(5)}</em>
                  </span>
                  <span className="frontier-distance">{fmtMeters(entry.dist)}</span>
                  {pathSet.has(entry.vertex) && <span className="on-path-dot" title="On final path" />}
                </div>
              );
            })}
            {frontier && frontier.entries.length > 8 && (
              <div className="frontier-more">
                + {fmtNumber(frontier.entries.length - 8)} more in the priority queue
              </div>
            )}
          </div>
        )}
        <p className="frontier-note">
          Best tentative distance per unsettled vertex. Lazy heap deletion means the raw heap also
          holds {frontier?.staleCount ?? 0} stale entries.
        </p>
      </div>

      <div className="log-toolbar">
        <div className="filter-pills">
          <button
            type="button"
            className={`filter-pill ${updatedOnly ? 'active' : ''}`}
            onClick={() => setUpdatedOnly((v) => !v)}
          >
            Updates only <em>{fmtNumber(updatedCount)}</em>
          </button>
          <button
            type="button"
            className={`filter-pill ${pathOnly ? 'active' : ''}`}
            onClick={() => setPathOnly((v) => !v)}
            disabled={!path}
          >
            Final path only <em>{fmtNumber(pathCount)}</em>
          </button>
          {(updatedOnly || pathOnly) && (
            <button
              type="button"
              className="filter-clear"
              onClick={() => {
                setUpdatedOnly(false);
                setPathOnly(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
        <span className="log-count">{fmtNumber(filtered.length)} rows</span>
      </div>

      <div className="table-wrap">
        <table className="step-table">
          <thead>
            <tr>
              <th className="col-step">Step</th>
              <th className="col-vertex">Settled vertex</th>
              <th className="col-dist">d(u)</th>
              <th className="col-relax">Relaxed edges (u→v, w, d(v), updated)</th>
              <th className="col-prev">prev(v)</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">
                  No settled rows match the current filters.
                </td>
              </tr>
            )}
            {pageRows.map((row) => {
              const c = vertexCoord(graph, row.vertex);
              const isCurrent = row.step === stepClamped;
              const updatedTargets = row.relaxed.filter((r) => r.updated);
              return (
                <tr
                  key={row.step}
                  className={`${isCurrent ? 'is-current' : ''} ${
                    pathSet.has(row.vertex) ? 'on-path' : ''
                  }`}
                  onClick={() => setStep(row.step)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setStep(row.step);
                    }
                  }}
                >
                  <td className="col-step">
                    {isCurrent && <span className="current-arrow" />}
                    {fmtNumber(row.step)}
                  </td>
                  <td className="col-vertex">
                    <b>v{row.vertex}</b>
                    <span className="coord">{c[0].toFixed(5)}, {c[1].toFixed(5)}</span>
                  </td>
                  <td className="col-dist">
                    {row.dist.toFixed(1)}
                    <span> m</span>
                  </td>
                  <td className="col-relax">
                    {row.relaxed.length === 0 ? (
                      <span className="muted-dash">no outgoing edges</span>
                    ) : (
                      <div className="relax-list">
                        {row.relaxed.slice(0, 4).map((rel, i) => (
                          <span
                            className={`relax ${rel.updated ? 'updated' : ''}`}
                            key={i}
                            title={`${row.vertex} → ${rel.to}, weight ${rel.weight.toFixed(2)} m, new d(${rel.to}) = ${rel.candidate.toFixed(2)} m`}
                          >
                            <em>→</em> v{rel.to}
                            <span>{rel.weight.toFixed(1)}</span>
                            <b>{rel.candidate.toFixed(1)}</b>
                            {rel.updated ? <CheckIcon size={10} /> : <i className="unchanged">=</i>}
                          </span>
                        ))}
                        {row.relaxed.length > 4 && (
                          <span className="relax-more">+{row.relaxed.length - 4}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="col-prev">
                    {updatedTargets.length === 0
                      ? '—'
                      : updatedTargets.map((rel) => (
                          <span className="prev-entry" key={rel.to}>
                            v{rel.to}←v{row.vertex}
                          </span>
                        ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <span>
          Rows {fmtNumber(firstRow)}–{fmtNumber(lastRow)} of {fmtNumber(filtered.length)}
        </span>
        <div className="pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, Math.min(p, pageCount - 1) - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            <ChevronLeftIcon size={14} />
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
          >
            <ChevronRightIcon size={14} />
          </button>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option value={size} key={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {stepClamped > 0 && !currentRowVisible && (
        <button
          type="button"
          className="go-current"
          onClick={() => {
            const idx = filtered.findIndex((row) => row.step === stepClamped);
            if (idx >= 0) setPage(Math.floor(idx / pageSize));
          }}
        >
          Go to current step {fmtNumber(stepClamped)}
        </button>
      )}

      <div className="method-card compact">
        <div className="method-card-head">
          <InfoIcon size={15} />
          <strong>Reading the table</strong>
        </div>
        <p>
          Rows are settlements in nondecreasing d(u). “Updated” means the candidate distance
          improved d(v); ties and already-settled vertices are skipped. The frontier replays the same
          binary heap, deduplicated to the best entry per vertex.
        </p>
        <p className="method-note">
          {activeLeg >= 0
            ? `This leg is route leg ${activeLeg + 1}; the highlighted path is the exact route stitched into the animation.`
            : 'This is an arbitrary directed pair from the distance matrix, not necessarily on the chosen route.'}
        </p>
      </div>
    </div>
  );
}
