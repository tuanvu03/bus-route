import type { RoutePlan } from '../lib/route';
import { fmtMeters } from '../lib/format';
import { pointLabel } from '../lib/labels';
import type { DijkstraMapView } from './MapView';

export function Legend({
  plan,
  dijkstra,
  activeTab,
}: {
  plan: RoutePlan | null;
  dijkstra: DijkstraMapView | null;
  activeTab: 'route' | 'dijkstra' | 'matrix';
}) {
  if (!plan && !dijkstra) return null;
  const total = plan?.points.length ?? 0;

  return (
    <div className="legend-card">
      {plan && activeTab !== 'dijkstra' && (
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
