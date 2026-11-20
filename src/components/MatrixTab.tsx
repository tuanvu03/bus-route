import type { RoutePlan } from '../lib/route';
import type { Graph } from '../lib/types';
import { pointLabel } from '../lib/labels';
import { InfoIcon } from './Icons';

interface MatrixTabProps {
  graph: Graph;
  plan: RoutePlan | null;
  activeLeg: [number, number] | null;
  onSelectLeg: (from: number, to: number) => void;
}

export function MatrixTab({ graph, plan, activeLeg, onSelectLeg }: MatrixTabProps) {
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

  const n = plan.points.length;
  const onOrder = new Set<string>();
  for (let i = 0; i + 1 < plan.order.length; i++) {
    onOrder.add(`${plan.order[i]}-${plan.order[i + 1]}`);
  }

  const cell = (m: number) => (Number.isFinite(m) ? (m / 1000).toFixed(2) : '—');

  return (
    <div className="matrix-tab">
      <div className="matrix-head">
        <div>
          <h3>Directed distance matrix</h3>
          <p>Rows = from, columns = to. Values in km.</p>
        </div>
        <span className="matrix-size">{n}×{n}</span>
      </div>

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="corner" scope="col">
                <span>from</span>
                <span>to →</span>
              </th>
              {plan.points.map((point, j) => (
                <th
                  key={j}
                  scope="col"
                  className={point.kind === 'destination' ? 'is-dest' : ''}
                  title={point.name}
                >
                  {pointLabel(j, n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.matrix.map((row, i) => (
              <tr key={i}>
                <th
                  scope="row"
                  className={plan.points[i].kind === 'destination' ? 'is-dest' : ''}
                  title={plan.points[i].name}
                >
                  {pointLabel(i, n)}
                </th>
                {row.map((value, j) => {
                  const active = activeLeg?.[0] === i && activeLeg?.[1] === j;
                  const ordered = onOrder.has(`${i}-${j}`);
                  const asym =
                    i !== j &&
                    Number.isFinite(value) &&
                    Number.isFinite(row[j]) &&
                    Number.isFinite(plan.matrix[j][i]) &&
                    Math.abs(value - plan.matrix[j][i]) > 1;
                  return (
                    <td
                      key={j}
                      className={[
                        active ? 'active' : '',
                        ordered ? 'on-order' : '',
                        asym ? 'asym' : '',
                        i === j ? 'diagonal' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={`${plan.points[i].name} → ${plan.points[j].name}: ${
                        Number.isFinite(value) ? `${value.toFixed(1)} m` : 'unreachable'
                      }`}
                      onClick={() => i !== j && onSelectLeg(i, j)}
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
      </div>

      <div className="point-key">
        <div className="subsection-heading">
          <h3>Key points</h3>
          <span>{n} nodes</span>
        </div>
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

      <div className="method-card compact">
        <div className="method-card-head">
          <InfoIcon size={15} />
          <strong>Asymmetric by construction</strong>
        </div>
        <p>
          A small amber dot marks a cell whose reverse direction has a different distance. Click any
          cell to open that directed leg in the Dijkstra step inspector.
        </p>
        <p className="method-note">
          Stops snap to the nearest vertex in the main graph component ({graph.meta.vertexCount.toLocaleString()} vertices).
        </p>
      </div>
    </div>
  );
}
