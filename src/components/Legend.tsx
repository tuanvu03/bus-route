import type { AlgorithmMode, Comparison, RoutePlan } from '../lib/route';
import { fmtMeters } from '../lib/format';
import { pointLabel } from '../lib/labels';
import type { DijkstraMapView } from './MapView';

const MODE_COLORS = { greedy: '#d9682c', optimal: '#2563eb' } as const;

export function Legend({
  plan,
  greedyPlan,
  optimalPlan,
  comparison,
  mode,
  routeVisibility,
  onToggleRoute,
  dijkstra,
  activeTab,
}: {
  plan: RoutePlan | null;
  greedyPlan: RoutePlan | null;
  optimalPlan: RoutePlan | null;
  comparison: Comparison | null;
  mode: AlgorithmMode;
  routeVisibility: { greedy: boolean; optimal: boolean };
  onToggleRoute: (target: 'greedy' | 'optimal') => void;
  dijkstra: DijkstraMapView | null;
  activeTab: 'route' | 'dijkstra' | 'matrix';
}) {
  if (!plan && !dijkstra) return null;
  const total = plan?.points.length ?? greedyPlan?.points.length ?? 0;
  const compare = mode === 'compare' && (greedyPlan || optimalPlan);

  return (
    <div className="legend-card">
      {compare && (
        <>
          <div className="legend-heading">Compare routes</div>
          <div className="legend-rows">
            {greedyPlan && (
              <button
                type="button"
                className={`legend-row legend-toggle ${routeVisibility.greedy ? 'on' : 'off'}`}
                onClick={() => onToggleRoute('greedy')}
              >
                <span className="legend-swatch" style={{ background: MODE_COLORS.greedy }} />
                <span className="legend-label">A · Greedy</span>
                <span className="legend-meta">{fmtMeters(greedyPlan.totalDistance)}</span>
              </button>
            )}
            {optimalPlan && (
              <button
                type="button"
                className={`legend-row legend-toggle ${routeVisibility.optimal ? 'on' : 'off'}`}
                onClick={() => onToggleRoute('optimal')}
              >
                <span className="legend-swatch" style={{ background: MODE_COLORS.optimal }} />
                <span className="legend-label">
                  B · {optimalPlan.algorithm === 'exact' ? 'Exact' : 'Heuristic'}
                </span>
                <span className="legend-meta">{fmtMeters(optimalPlan.totalDistance)}</span>
              </button>
            )}
            {comparison?.divergence && (
              <div className="legend-row legend-note-row">
                <span className="legend-line diverge" />
                <span className="legend-label">First divergence</span>
                <span className="legend-meta">leg {comparison.divergence.legIndex + 1}</span>
              </div>
            )}
          </div>
        </>
      )}

      {!compare && plan && activeTab !== 'dijkstra' && (
        <>
          <div className="legend-heading">Route legs</div>
          <div className="legend-legs">
            {plan.legs.map((leg, i) => (
              <div className="legend-row" key={`legend-${i}`}>
                <span className="legend-swatch" style={{ background: leg.color }} />
                <span className="legend-label">
                  {pointLabel(leg.from, total)} → {pointLabel(leg.to, total)}
                </span>
                <span className="legend-meta">{fmtMeters(leg.distance)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'dijkstra' && dijkstra && (
        <>
          <div className="legend-heading">Dijkstra overlay</div>
          <div className="legend-rows">
            <div className="legend-row">
              <span className="legend-dot settled" />
              <span className="legend-label">Settled vertex</span>
              <span className="legend-meta">step {dijkstra.stepIndex}</span>
            </div>
            <div className="legend-row">
              <span className="legend-dot frontier" />
              <span className="legend-label">Frontier</span>
              <span className="legend-meta">{dijkstra.frontier.length}</span>
            </div>
            <div className="legend-row">
              <span className="legend-line updated" />
              <span className="legend-label">Improved edge</span>
            </div>
            <div className="legend-row">
              <span className="legend-line loose" />
              <span className="legend-label">No improvement</span>
            </div>
            <div className="legend-row">
              <span className="legend-line path" />
              <span className="legend-label">Final shortest path</span>
            </div>
          </div>
        </>
      )}

      <div className="legend-note">
        <span className="legend-line snap" />
        Stop → snapped road vertex
      </div>
    </div>
  );
}
