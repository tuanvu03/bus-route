import type {
  AlgorithmMode,
  RoutePlan,
  SelectedStop,
  SolveResult,
  UnreachableInfo,
} from '../lib/route';
import { totalPassengers } from '../lib/route';
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

type AnimMode = 'greedy' | 'optimal';

interface RouteTabProps {
  result: SolveResult | null;
  unreachable: UnreachableInfo | null;
  selected: SelectedStop[];
  mode: AlgorithmMode;
  animMode: AnimMode;
  onAnimModeChange: (mode: AnimMode) => void;
  onInspectLeg: (from: number, to: number) => void;
  onOpenMatrix: () => void;
}

const MODE_NAME: Record<AlgorithmMode, string> = {
  greedy: 'Mode A · Dijkstra only',
  'held-karp': 'Mode B · Dijkstra + Held-Karp',
  compare: 'Mode C · Compare A vs B',
};

export function RouteTab({
  result,
  unreachable,
  selected,
  mode,
  animMode,
  onAnimModeChange,
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

  if (!result || !result.plan) {
    return (
      <div className="route-tab">
        <div className="empty-panel">
          <span className="empty-panel-icon accent">
            <SparkIcon size={24} />
          </span>
          <h3>Find the best pickup loop</h3>
          <p>
            Choose any number of waiting stops while the total stays within the 20-passenger bus
            capacity, then run one of the three algorithm modes. Start and destination are fixed.
          </p>
          <ol className="how-list">
            <li><b>1</b><span>Pick stops manually, load a preset, or generate a seeded random scenario.</span></li>
            <li><b>2</b><span>Run Mode A (greedy), Mode B (exact/heuristic), or Mode C (compare both).</span></li>
            <li><b>3</b><span>Step through the lazy Dijkstra log, inspect the matrix, and animate the chosen route.</span></li>
          </ol>
          <p className="method-note">{MODE_NAME[mode]} is selected.</p>
        </div>
      </div>
    );
  }

  const primary = result.plan;
  const animationPlan =
    result.mode === 'greedy'
      ? result.greedy
      : result.mode === 'held-karp'
        ? result.optimal
        : animMode === 'greedy'
          ? result.greedy
          : result.optimal;
  const passengerTotal = totalPassengers(selected);
  const comparison = result.comparison;

  return (
    <div className="route-tab">
      {result.mode === 'compare' && comparison && result.greedy && result.optimal ? (
        <>
          <div className="result-hero compare-hero">
            <div className="result-kicker">
              <span className="solved-dot" />
              Compare A vs B
              <span className="method-chip">same matrix</span>
            </div>
            <div className="compare-headline">
              <strong>
                {comparison.equal
                  ? 'Greedy already found the optimal order'
                  : comparison.gap >= 0
                    ? `B saves ${Math.round(comparison.gap)} m (${(
                        comparison.gap / 1000
                      ).toFixed(2)} km) over A`
                    : `A is shorter by ${Math.round(-comparison.gap)} m — correctness bug`}
              </strong>
              <span>
                {comparison.equal
                  ? 'Both visiting orders have the same total distance (within 0.5 m).'
                  : `${Math.abs(comparison.gapPct).toFixed(2)}% difference · ${
                      comparison.exact ? 'B is exact (Held-Karp)' : 'B is heuristic (not proven optimal)'
                    }`}
              </span>
            </div>
            <div className="result-sub">
              {comparison.greedy.order.length - 2} stops · {passengerTotal} passengers · matrix{' '}
              {comparison.greedy.points.length}×{comparison.greedy.points.length} · shared Dijkstra
              matrix {result.matrixMs.toFixed(1)} ms
            </div>
            <div className="anim-toggle" role="group" aria-label="Route to animate">
              <span>Animate</span>
              <button
                type="button"
                className={animMode === 'greedy' ? 'active greedy' : ''}
                onClick={() => onAnimModeChange('greedy')}
              >
                A · Greedy
              </button>
              <button
                type="button"
                className={animMode === 'optimal' ? 'active optimal' : ''}
                onClick={() => onAnimModeChange('optimal')}
              >
                B · {comparison.optimal.algorithm === 'exact' ? 'Held-Karp' : 'Heuristic'}
              </button>
            </div>
          </div>

          <div className="compare-grid">
            <ModeCard
              side="A"
              plan={comparison.greedy}
              matrixMs={result.matrixMs}
              passengerTotal={passengerTotal}
              onInspectLeg={onInspectLeg}
            />
            <ModeCard
              side="B"
              plan={comparison.optimal}
              matrixMs={result.matrixMs}
              passengerTotal={passengerTotal}
              onInspectLeg={onInspectLeg}
            />
          </div>

          <DivergenceCard comparison={comparison} onInspectLeg={onInspectLeg} />

          {comparison.optimal.heuristic && (
            <HeuristicCard plan={comparison.optimal} onInspectLeg={onInspectLeg} />
          )}

          {comparison.optimal.alternatives.length > 0 && (
            <AlternativesCard plan={comparison.optimal} />
          )}

          {animationPlan && (
            <div className="animated-route">
              <div className="subsection-heading">
                <h3>Animated route · {animMode === 'greedy' ? 'A (Greedy)' : 'B'}</h3>
                <span>{animationPlan.algorithmLabel}</span>
              </div>
              <RouteTimeline plan={animationPlan} selected={selected} onInspectLeg={onInspectLeg} />
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`result-hero ${primary.algorithm}`}>
            <div className="result-kicker">
              <span className="solved-dot" />
              {primary.algorithm === 'greedy'
                ? 'Greedy route'
                : primary.algorithm === 'exact'
                  ? 'Optimal route'
                  : 'Heuristic route'}
              <span className="method-chip">{primary.algorithmLabel}</span>
            </div>
            <div className="result-distance">
              {fmtMeters(primary.totalDistance)}
              <span>
                {Math.round(primary.totalDistance)} m ·{' '}
                {(primary.totalDistance / 1000).toFixed(2)} km total distance
              </span>
            </div>
            <div className="result-sub">
              {primary.order.length - 2} stops · {primary.legs.length} legs · {passengerTotal}{' '}
              passengers · {MODE_NAME[result.mode]}
            </div>
            <div className="result-stats">
              <div>
                <span>Stops</span>
                <b>{primary.order.length - 2}</b>
              </div>
              <div>
                <span>Passengers</span>
                <b>{passengerTotal}</b>
              </div>
              <div>
                <span>Matrix</span>
                <b>{primary.points.length}×{primary.points.length}</b>
              </div>
              <div>
                <span>Order solve</span>
                <b>{primary.solveMs.toFixed(1)} ms</b>
              </div>
              <div>
                <span>Dijkstra matrix</span>
                <b>{result.matrixMs.toFixed(1)} ms</b>
              </div>
            </div>
          </div>

          {primary.algorithm === 'heuristic' && (
            <div className="inline-banner info">
              <WarningIcon size={15} />
              <span>
                Heuristic result — not proven optimal. n = {primary.order.length - 2} exceeds the
                Held-Karp limit of {result.hkLimit}.
              </span>
            </div>
          )}

          {primary.heuristic && (
            <HeuristicCard plan={primary} onInspectLeg={onInspectLeg} />
          )}

          <div className="subsection-heading route-order-heading">
            <h3>Visiting order</h3>
            <span>{primary.algorithmLabel}</span>
          </div>
          <OrderFlow plan={primary} />

          <RouteTimeline plan={primary} selected={selected} onInspectLeg={onInspectLeg} />

          {primary.alternatives.length > 0 && <AlternativesCard plan={primary} />}
        </>
      )}

      <div className="route-actions">
        <button type="button" className="outline-button" onClick={onOpenMatrix}>
          <span>Open distance matrix</span>
          <ArrowRightIcon size={14} />
        </button>
      </div>

      {result.warnings.map((warning, index) => (
        <div className="inline-banner info" key={index}>
          <WarningIcon size={15} />
          <span>{warning}</span>
        </div>
      ))}

      <div className="method-card">
        <div className="method-card-head">
          <InfoIcon size={15} />
          <strong>How this result was produced</strong>
        </div>
        <p>
          Dijkstra ran from the start and from every selected stop, producing a directed{' '}
          <b>{primary.points.length}×{primary.points.length} matrix</b> in {result.matrixMs.toFixed(1)} ms.
          The destination is terminal, so its outgoing row is not computed. The same matrix is
          reused by every mode in a comparison.
        </p>
        {result.mode === 'greedy' && (
          <p>
            Mode A repeatedly takes the nearest not-yet-visited stop by real road distance and breaks
            ties by the smaller graph vertex id. It never searches permutations, so it works for any
            number of stops.
          </p>
        )}
        {(result.mode === 'held-karp' || result.mode === 'compare') && (
          <p>
            {primary.algorithm === 'exact'
              ? `Held-Karp fixes the start and destination and solves the stop subset DP in O(n²·2ⁿ). n = ${primary.order.length - 2} is within the ${result.hkLimit}-stop limit.`
              : `n = ${primary.order.length - 2} exceeds the ${result.hkLimit}-stop Held-Karp limit, so nearest neighbour was improved with Or-opt. Reversal-based 2-opt is not used because one-way streets make the matrix asymmetric.`}
          </p>
        )}
        <p className="method-note">
          One-way streets make the matrix asymmetric, so A→B can be shorter than B→A.
        </p>
      </div>

      <div className="verified-row">
        <span><CheckIcon size={13} /> all stops visited once</span>
        <span><CheckIcon size={13} /> directed distances respected</span>
        <span><CheckIcon size={13} /> {MODE_NAME[result.mode]}</span>
      </div>
    </div>
  );
}

function ModeCard({
  side,
  plan,
  matrixMs,
  passengerTotal,
  onInspectLeg,
}: {
  side: 'A' | 'B';
  plan: RoutePlan;
  matrixMs: number;
  passengerTotal: number;
  onInspectLeg: (from: number, to: number) => void;
}) {
  const total = plan.points.length;
  return (
    <div className={`mode-card ${side === 'A' ? 'greedy' : 'optimal'}`}>
      <div className="mode-card-head">
        <span className="mode-letter">{side}</span>
        <div>
          <strong>{side === 'A' ? 'Greedy nearest stop' : plan.algorithmLabel}</strong>
          <em>
            order solve {plan.solveMs.toFixed(1)} ms · matrix {matrixMs.toFixed(1)} ms shared
          </em>
        </div>
      </div>
      <div className="mode-distance">
        {fmtMeters(plan.totalDistance)}
        <span>
          {Math.round(plan.totalDistance)} m · {(plan.totalDistance / 1000).toFixed(2)} km
        </span>
      </div>
      <div className="mode-meta">
        <span>{plan.order.length - 2} stops</span>
        <span>{plan.legs.length} legs</span>
        <span>{passengerTotal} passengers</span>
      </div>

      <div className="mode-order">
        <span className="mini-heading">Visiting order</span>
        <div className="order-flow compact">
          {plan.order.map((index, position) => {
            const point = plan.points[index];
            return (
              <span className="order-chip" key={`${index}-${position}`}>
                <b>{pointLabel(index, total)}</b>
                {point.name}
                {point.stop?.routeRef ? <em>{point.stop.routeRef}</em> : null}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mode-legs">
        <span className="mini-heading">Per-leg distances</span>
        <div className="leg-distance-list">
          {plan.legs.map((leg, index) => (
            <button
              type="button"
              className="leg-distance-row"
              key={`${leg.from}-${leg.to}-${index}`}
              onClick={() => onInspectLeg(leg.from, leg.to)}
              title="Open this leg in the Dijkstra log"
            >
              <span className="leg-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="leg-name">
                {pointLabel(leg.from, total)} → {pointLabel(leg.to, total)}
                <em>{plan.points[leg.to].name}</em>
              </span>
              <b>{fmtMeters(leg.distance)}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DivergenceCard({
  comparison,
  onInspectLeg,
}: {
  comparison: NonNullable<SolveResult['comparison']>;
  onInspectLeg: (from: number, to: number) => void;
}) {
  const divergence = comparison.divergence;
  if (!divergence) {
    return (
      <div className="divergence-card same">
        <div className="method-card-head">
          <CheckIcon size={15} />
          <strong>Why they differ</strong>
        </div>
        <p>The two visiting orders are identical, so there is no divergence to explain.</p>
      </div>
    );
  }
  const points = comparison.optimal.points;
  const total = points.length;
  return (
    <div className="divergence-card">
      <div className="method-card-head">
        <InfoIcon size={15} />
        <strong>Why they differ</strong>
        <span>first divergence · leg {divergence.legIndex + 1}</span>
      </div>
      <p>
        Both routes are at <b>{points[divergence.from].name}</b>. Greedy goes next to{' '}
        <b>{points[divergence.greedyTo].name}</b> ({fmtMeters(divergence.greedyDistance)}), while B
        goes to <b>{points[divergence.optimalTo].name}</b> (
        {fmtMeters(divergence.optimalDistance)}).
      </p>
      <div className="divergence-actions">
        <button type="button" onClick={() => onInspectLeg(divergence.from, divergence.greedyTo)}>
          Inspect A leg {pointLabel(divergence.from, total)} → {pointLabel(divergence.greedyTo, total)}
        </button>
        <button type="button" onClick={() => onInspectLeg(divergence.from, divergence.optimalTo)}>
          Inspect B leg {pointLabel(divergence.from, total)} → {pointLabel(divergence.optimalTo, total)}
        </button>
      </div>
    </div>
  );
}

function HeuristicCard({
  plan,
  onInspectLeg,
}: {
  plan: RoutePlan;
  onInspectLeg: (from: number, to: number) => void;
}) {
  const info = plan.heuristic;
  if (!info) return null;
  const total = plan.points.length;
  return (
    <div className="heuristic-card">
      <div className="method-card-head">
        <WarningIcon size={15} />
        <strong>Heuristic fallback · not proven optimal</strong>
        <span>Or-opt</span>
      </div>
      <div className="heuristic-grid">
        <div>
          <span className="mini-heading">Initial greedy order</span>
          <div className="order-flow compact">
            {info.initialOrder.map((index, position) => (
              <span className="order-chip" key={`initial-${index}-${position}`}>
                <b>{pointLabel(index, total)}</b>
                {plan.points[index].name}
              </span>
            ))}
          </div>
          <b className="heuristic-distance">{fmtMeters(info.initialDistance)}</b>
        </div>
        <div>
          <span className="mini-heading">Improved Or-opt order</span>
          <div className="order-flow compact">
            {info.improvedOrder.map((index, position) => (
              <span className="order-chip" key={`improved-${index}-${position}`}>
                <b>{pointLabel(index, total)}</b>
                {plan.points[index].name}
              </span>
            ))}
          </div>
          <b className="heuristic-distance">{fmtMeters(info.improvedDistance)}</b>
        </div>
      </div>
      <p>
        Improvement {fmtMeters(info.improvedBy)} ({info.passes} Or-opt pass
        {info.passes === 1 ? '' : 'es'}). Segments are moved without reversing them, which is valid
        for asymmetric distances.
      </p>
      <div className="divergence-actions">
        <button
          type="button"
          onClick={() => onInspectLeg(plan.order[0], plan.order[1])}
        >
          Inspect first leg
        </button>
      </div>
    </div>
  );
}

function AlternativesCard({ plan }: { plan: RoutePlan }) {
  const total = plan.points.length;
  return (
    <div className="alternatives">
      <div className="subsection-heading">
        <h3>Next-best orders</h3>
        <span>{plan.algorithm === 'exact' ? 'enumerated / local' : 'local perturbations'}</span>
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
  );
}

function OrderFlow({ plan }: { plan: RoutePlan }) {
  const total = plan.points.length;
  return (
    <div className="order-flow">
      {plan.order.map((index, position) => {
        const point = plan.points[index];
        return (
          <span className="order-chip" key={`${index}-${position}`}>
            <b>{pointLabel(index, total)}</b>
            {point.name}
            {point.stop?.routeRef ? <em>{point.stop.routeRef}</em> : null}
          </span>
        );
      })}
    </div>
  );
}

function RouteTimeline({
  plan,
  selected,
  onInspectLeg,
}: {
  plan: RoutePlan;
  selected: SelectedStop[];
  onInspectLeg: (from: number, to: number) => void;
}) {
  const total = plan.points.length;
  const stopPassengers = new Map(selected.map((s) => [s.stop.id, s.passengers]));

  return (
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
              title="Open this leg in the Dijkstra log"
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
  );
}
