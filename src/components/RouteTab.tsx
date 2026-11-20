import type { RoutePlan, SelectedStop, UnreachableInfo } from '../lib/route';
import { fmtMeters } from '../lib/format';
import { pointLabel } from '../lib/labels';
import {
  ArrowRightIcon,
  CheckIcon,
  FlagIcon,
  InfoIcon,
  SparkIcon,
  StationIcon,
  WarningIcon,
} from './Icons';

interface RouteTabProps {
  plan: RoutePlan | null;
  unreachable: UnreachableInfo | null;
  selected: SelectedStop[];
  computeMs: number | null;
  onInspectLeg: (from: number, to: number) => void;
  onOpenMatrix: () => void;
}

export function RouteTab({
  plan,
  unreachable,
  selected,
  computeMs,
  onInspectLeg,
  onOpenMatrix,
}: RouteTabProps) {
  if (unreachable) {
    return (
      <div className="route-tab">
        <div className="empty-panel danger">
          <span className="empty-panel-icon">
            <WarningIcon size={24} />
          </span>
          <h3>No feasible visiting order</h3>
          <p>{unreachable.message}</p>
          {unreachable.pairs.length > 0 && (
            <div className="unreachable-list">
              {unreachable.pairs.map((pair, i) => (
                <div className="unreachable-pair" key={i}>
                  <span>{pair.fromName}</span>
                  <ArrowRightIcon size={13} />
                  <span>{pair.toName}</span>
                  <em>unreachable</em>
                </div>
              ))}
            </div>
          )}
          <p className="empty-hint">
            Remove one of the conflicting stops or pick stops closer to the campus loop and run
            again.
          </p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="route-tab">
        <div className="empty-panel">
          <span className="empty-panel-icon accent">
            <SparkIcon size={24} />
          </span>
          <h3>Find the best pickup loop</h3>
          <p>
            Choose up to nine waiting stops, set passenger counts, then run the optimiser. The bus
            visits every stop once and ends at the campus gate.
          </p>
          <ol className="how-list">
            <li><b>1</b><span>Pick stops on the map or in the left list.</span></li>
            <li><b>2</b><span>Run the directed Dijkstra matrix + Held-Karp DP.</span></li>
            <li><b>3</b><span>Step through the calculations or animate the bus.</span></li>
          </ol>
        </div>
      </div>
    );
  }

  const total = plan.points.length;
  const passengerTotal = selected.reduce((sum, s) => sum + s.passengers, 0);
  const stopPassengers = new Map(selected.map((s) => [s.stop.id, s.passengers]));

  return (
    <div className="route-tab">
      <div className="result-hero">
        <div className="result-kicker">
          <span className="solved-dot" />
          Optimal route
          <span className="method-chip">Held-Karp</span>
        </div>
        <div className="result-distance">
          {fmtMeters(plan.totalDistance)}
          <span>total distance</span>
        </div>
        <div className="result-sub">
          {plan.order.length - 2} stops · {plan.legs.length} legs · {passengerTotal} passengers
        </div>
        <div className="result-stats">
          <div>
            <span>Stops</span>
            <b>{plan.order.length - 2}</b>
          </div>
          <div>
            <span>Passengers</span>
            <b>{passengerTotal}</b>
          </div>
          <div>
            <span>Matrix</span>
            <b>{total}×{total}</b>
          </div>
          <div>
            <span>Solve time</span>
            <b>{computeMs !== null ? `${computeMs} ms` : '—'}</b>
          </div>
        </div>
      </div>

      <div className="route-timeline">
        <div className="timeline-start">
          <span className="timeline-node start">
            <StationIcon size={13} />
          </span>
          <div>
            <span className="timeline-kicker">Start · {pointLabel(0, total)}</span>
            <strong>{plan.points[0].name}</strong>
          </div>
        </div>

        {plan.order.slice(1).map((pointIndex, idx) => {
          const leg = plan.legs[idx];
          const point = plan.points[pointIndex];
          const passengers = point.stop ? stopPassengers.get(point.stop.id) : undefined;
          return (
            <div className="timeline-step" key={`${pointIndex}-${idx}`}>
              <button
                type="button"
                className="timeline-leg"
                onClick={() => onInspectLeg(leg.from, leg.to)}
                title="Open this leg in the Dijkstra inspector"
              >
                <span className="leg-rail">
                  <span className="leg-line" style={{ background: leg.color }} />
                </span>
                <span className="leg-copy">
                  <span>
                    Leg {String(idx + 1).padStart(2, '0')} · {fmtMeters(leg.distance)}
                  </span>
                  <em>{leg.path.length} vertices · inspect</em>
                </span>
                <ArrowRightIcon size={14} />
              </button>
              <span className="timeline-node" style={{ borderColor: leg.color }}>
                {pointLabel(pointIndex, total)}
              </span>
              <div className="timeline-stop">
                <div className="timeline-stop-head">
                  <strong>{point.name}</strong>
                  {passengers !== undefined && (
                    <span className="pickup-count">{passengers} waiting</span>
                  )}
                  {point.kind === 'destination' && (
                    <span className="pickup-count dest">
                      <FlagIcon size={11} /> destination
                    </span>
                  )}
                </div>
                <span>
                  {point.kind === 'destination'
                    ? 'Trip complete · passengers delivered'
                    : `Pickup stop · ${point.stop?.routeRef ?? 'local bus stop'}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="route-actions">
        <button type="button" className="outline-button" onClick={onOpenMatrix}>
          <span>Open distance matrix</span>
          <ArrowRightIcon size={14} />
        </button>
      </div>

      <div className="method-card">
        <div className="method-card-head">
          <InfoIcon size={15} />
          <strong>How this order was chosen</strong>
        </div>
        <p>
          Dijkstra ran from every key point on the directed graph, producing a{' '}
          <b>directed {total}×{total} matrix</b>. Held-Karp optimises across all{' '}
          {plan.order.length - 2 <= 9 ? `${factorial(plan.order.length - 2).toLocaleString()} ` : ''}
          possible visiting orders by dynamic programming in O(2<sup>n</sup>·n<sup>2</sup>).
        </p>
        <p className="method-note">
          One-way streets make the matrix asymmetric, so A→B can be shorter than B→A.
        </p>
      </div>

      {plan.alternatives.length > 0 && (
        <div className="alternatives">
          <div className="subsection-heading">
            <h3>Next-best orders</h3>
            <span>enumeration</span>
          </div>
          {plan.alternatives.map((alt, i) => (
            <div className="alt-row" key={i}>
              <span className="alt-order">
                {alt.order.map((p) => pointLabel(p, total)).join(' → ')}
              </span>
              <span className="alt-cost">{fmtMeters(alt.cost)}</span>
              <span className="alt-delta">+{fmtMeters(alt.delta)}</span>
            </div>
          ))}
        </div>
      )}

      {plan.alternatives.length === 0 && plan.order.length - 2 > 7 && (
        <p className="method-note">
          Alternative orders are hidden for 8–9 stops; only the exact Held-Karp optimum is shown.
        </p>
      )}

      <div className="verified-row">
        <span><CheckIcon size={13} /> all stops visited once</span>
        <span><CheckIcon size={13} /> directed distances respected</span>
      </div>
    </div>
  );
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}
