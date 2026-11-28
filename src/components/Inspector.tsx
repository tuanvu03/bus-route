import { memo } from 'react';
import type { Graph } from '../lib/types';
import type {
  AlgorithmMode,
  RoutePlan,
  SelectedStop,
  SolveResult,
  UnreachableInfo,
} from '../lib/route';
import type { DijkstraResult } from '../lib/dijkstra';
import { RouteTab } from './RouteTab';
import { DijkstraTab } from './DijkstraTab';
import { MatrixTab } from './MatrixTab';
import { InfoIcon } from './Icons';

export type InspectorTab = 'route' | 'dijkstra' | 'matrix';
export type AnimMode = 'greedy' | 'optimal';

interface InspectorProps {
  graph: Graph;
  result: SolveResult | null;
  plan: RoutePlan | null;
  unreachable: UnreachableInfo | null;
  selected: SelectedStop[];
  mode: AlgorithmMode;
  animMode: AnimMode;
  tab: InspectorTab;
  leg: [number, number] | null;
  step: number;
  run: DijkstraResult | null;
  legLoading: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onLegChange: (from: number, to: number) => void;
  onStepChange: (step: number) => void;
  onAnimModeChange: (mode: AnimMode) => void;
}

const TAB_LABELS: { key: InspectorTab; label: string }[] = [
  { key: 'route', label: 'Route & compare' },
  { key: 'dijkstra', label: 'Dijkstra log' },
  { key: 'matrix', label: 'Matrix' },
];

export const Inspector = memo(function Inspector({
  graph,
  result,
  plan,
  unreachable,
  selected,
  mode,
  animMode,
  tab,
  leg,
  step,
  run,
  legLoading,
  onTabChange,
  onLegChange,
  onStepChange,
  onAnimModeChange,
}: InspectorProps) {
  const plans = [result?.greedy, result?.optimal, plan].filter(
    (item): item is RoutePlan => Boolean(item),
  );
  const uniquePlans = plans.filter(
    (item, index) => plans.findIndex((other) => other.order.join(',') === item.order.join(',')) === index,
  );

  const stateLabel = !plan
    ? 'waiting for run'
    : result?.mode === 'compare'
      ? 'A vs B'
      : plan.algorithm === 'exact'
        ? 'optimal'
        : plan.algorithm === 'heuristic'
          ? 'heuristic'
          : 'greedy';

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-tabs" role="tablist" aria-label="Route inspector tabs">
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => onTabChange(key)}
            >
              {label}
              {key === 'matrix' && plan && (
                <span className="tab-badge">{plan.points.length}²</span>
              )}
            </button>
          ))}
        </div>
        <span className={`inspector-state ${plan ? 'solved' : ''} ${plan?.algorithm ?? ''}`}>
          {plan ? (
            <>
              <span className="status-dot" /> {stateLabel}
            </>
          ) : (
            <>
              <InfoIcon size={12} /> {stateLabel}
            </>
          )}
        </span>
      </div>

      <div className="inspector-body">
        {tab === 'route' && (
          <RouteTab
            result={result}
            unreachable={unreachable}
            selected={selected}
            mode={mode}
            animMode={animMode}
            onAnimModeChange={onAnimModeChange}
            onInspectLeg={onLegChange}
            onOpenMatrix={() => onTabChange('matrix')}
          />
        )}
        {tab === 'dijkstra' && (
          <DijkstraTab
            graph={graph}
            plan={plan}
            plans={uniquePlans}
            run={run}
            loading={legLoading}
            leg={leg}
            step={step}
            onLegChange={onLegChange}
            onStepChange={onStepChange}
          />
        )}
        {tab === 'matrix' && (
          <MatrixTab
            graph={graph}
            plan={plan}
            activeLeg={leg}
            onSelectLeg={onLegChange}
          />
        )}
      </div>
    </aside>
  );
});
