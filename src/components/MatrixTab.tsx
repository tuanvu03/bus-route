import { useEffect, useMemo, useState } from 'react';
import type { RoutePlan } from '../lib/route';
import type { Graph } from '../lib/types';
import { pointLabel } from '../lib/labels';
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon } from './Icons';

interface MatrixTabProps {
  graph: Graph;
  plan: RoutePlan | null;
  activeLeg: [number, number] | null;
  onSelectLeg: (from: number, to: number) => void;
}

const WINDOW_SIZE = 18;
const VIRTUALIZE_ABOVE = 24;

export function MatrixTab({ graph, plan, activeLeg, onSelectLeg }: MatrixTabProps) {
  const [page, setPage] = useState(0);

  const n = plan?.points.length ?? 0;
  const virtualized = n > VIRTUALIZE_ABOVE;
  const pageCount = virtualized ? Math.ceil(n / WINDOW_SIZE) : 1;

  useEffect(() => {
    setPage(0);
  }, [n]);

  useEffect(() => {
    if (!virtualized || !activeLeg) return;
    const target = Math.min(activeLeg[0], activeLeg[1]);
    setPage(Math.min(pageCount - 1, Math.max(0, Math.floor(target / WINDOW_SIZE))));
  }, [activeLeg, virtualized, pageCount]);

  const rows = useMemo(() => {
    if (!plan) return [] as number[];
    if (!virtualized) return plan.matrix.map((_, i) => i);
    const start = page * WINDOW_SIZE;
    return Array.from({ length: Math.min(WINDOW_SIZE, n - start) }, (_, i) => start + i);
  }, [plan, virtualized, page, n]);

  if (!plan) {
    return (
      <div className="matrix-tab">
        <div className="empty-panel">
          <span className="empty-panel-icon">M</span>
          <h3>No matrix yet</h3>
          <p>Run the optimiser to build the directed pairwise distance matrix for this trip.</p>
        </div>
      </div>
    );
  }

  const onOrder = new Set<string>();
  for (let i = 0; i + 1 < plan.order.length; i++) {
    onOrder.add(`${plan.order[i]}-${plan.order[i + 1]}`);
  }

  const cell = (value: number) => {
    if (Number.isNaN(value)) return 'n/c';
    if (!Number.isFinite(value)) return '—';
    return (value / 1000).toFixed(2);
  };

  return (
    <div className="matrix-tab">
      <div className="matrix-head">
        <div>
          <h3>Directed distance matrix</h3>
          <p>
            Rows = from, columns = to. Values in km. The destination row is terminal and is not
            computed; open that leg in the Dijkstra tab to compute it lazily.
          </p>
        </div>
        <span className="matrix-size">{n}×{n}</span>
      </div>

      {virtualized && (
        <div className="matrix-pager">
          <span>
            rows/cols {page * WINDOW_SIZE + 1}–{Math.min(n, (page + 1) * WINDOW_SIZE)} of {n}
          </span>
          <div>
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
              aria-label="Previous matrix page"
            >
              <ChevronLeftIcon size={14} />
            </button>
            <span>{page + 1} / {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={page >= pageCount - 1}
              aria-label="Next matrix page"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="corner" scope="col">
                <span>from</span>
                <span>to →</span>
              </th>
              {rows.map((j) => (
                <th
                  key={j}
                  scope="col"
                  className={plan.points[j].kind === 'destination' ? 'is-dest' : ''}
                  title={plan.points[j].name}
                >
                  {pointLabel(j, n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i}>
                <th
                  scope="row"
                  className={plan.points[i].kind === 'destination' ? 'is-dest' : ''}
                  title={plan.points[i].name}
                >
                  {pointLabel(i, n)}
                </th>
                {rows.map((j) => {
                  const value = plan.matrix[i][j];
                  const active = activeLeg?.[0] === i && activeLeg?.[1] === j;
                  const ordered = onOrder.has(`${i}-${j}`);
                  const asym =
                    i !== j &&
                    Number.isFinite(value) &&
                    Number.isFinite(plan.matrix[j][i]) &&
                    Math.abs(value - plan.matrix[j][i]) > 1;
                  const notComputed = Number.isNaN(value);
                  return (
                    <td
                      key={j}
                      className={[
                        active ? 'active' : '',
                        ordered ? 'on-order' : '',
                        asym ? 'asym' : '',
                        i === j ? 'diagonal' : '',
                        notComputed ? 'not-computed' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={`${plan.points[i].name} → ${plan.points[j].name}: ${
                        notComputed
                          ? 'not computed (destination is terminal)'
                          : Number.isFinite(value)
                            ? `${value.toFixed(1)} m`
                            : 'unreachable'
                      }`}
                      onClick={() => i !== j && !notComputed && onSelectLeg(i, j)}
                    >
                      {cell(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="matrix-legend">
        <span><i className="swatch order" /> on the chosen route</span>
        <span><i className="swatch asym" /> reverse direction differs</span>
        <span><i className="swatch active" /> current Dijkstra leg</span>
        <span><i className="swatch uncomputed" /> destination row not computed</span>
      </div>

      <div className="point-key">
        <div className="subsection-heading">
          <h3>Key points</h3>
          <span>{n} nodes</span>
        </div>
        <div className="point-key-scroll">
          {plan.points.map((point, i) => (
            <button
              type="button"
              className="point-key-row"
              key={i}
              onClick={() => onSelectLeg(i, (i + 1) % n)}
              title="Inspect a leg starting here"
            >
              <span className={`key-label ${point.kind}`}>{pointLabel(i, n)}</span>
              <span className="key-name">{point.name}</span>
              <span className="key-vertex">v{point.vertex}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="method-card compact">
        <div className="method-card-head">
          <InfoIcon size={15} />
          <strong>Asymmetric by construction</strong>
        </div>
        <p>
          A small amber dot marks a cell whose reverse direction has a different distance. Click any
          computed cell to open that directed leg in the Dijkstra step inspector. Large matrices are
          paginated in {WINDOW_SIZE}×{WINDOW_SIZE} windows instead of being rendered all at once.
        </p>
        <p className="method-note">
          Stops snap to the nearest vertex in the main graph component ({graph.meta.vertexCount.toLocaleString()} vertices).
        </p>
      </div>
    </div>
  );
}
