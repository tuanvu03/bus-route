import { memo } from 'react';
import type { Graph } from '../lib/types';
import type { RoutePlan, SelectedStop, UnreachableInfo } from '../lib/route';
import { RouteTab } from './RouteTab';
import { DijkstraTab } from './DijkstraTab';
import { MatrixTab } from './MatrixTab';
import { InfoIcon } from './Icons';

export type InspectorTab = 'route' | 'dijkstra' | 'matrix';

interface InspectorProps {
  graph: Graph;
  plan: RoutePlan | null;
  unreachable: UnreachableInfo | null;
  selected: SelectedStop[];
  computeMs: number | null;
  tab: InspectorTab;
  leg: [number, number] | null;
  step: number;
  onTabChange: (tab: InspectorTab) => void;
  onLegChange: (from: number, to: number) => void;
  onStepChange: (step: number) => void;
}

const TAB_LABELS: { key: InspectorTab; label: string }[] = [
  { key: 'route', label: 'Route' },
  { key: 'dijkstra', label: 'Dijkstra log' },
  { key: 'matrix', label: 'Matrix' },
];

export const Inspector = memo(function Inspector({
  graph,
  plan,
  unreachable,
  selected,
  computeMs,
  tab,
  leg,
  step,
  onTabChange,
  onLegChange,
  onStepChange,
}: InspectorProps) {
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
        <span className={`inspector-state ${plan ? 'solved' : ''}`}>
          {plan ? (
            <>
              <span className="status-dot" /> optimal
            </>
          ) : (
            <>
              <InfoIcon size={12} /> waiting for run
            </>
          )}
        </span>
      </div>

      <div className="inspector-body">
        {tab === 'route' && (
          <RouteTab
            plan={plan}
            unreachable={unreachable}
            selected={selected}
            computeMs={computeMs}
            onInspectLeg={onLegChange}
            onOpenMatrix={() => onTabChange('matrix')}
          />
        )}
        {tab === 'dijkstra' && (
          <DijkstraTab
            graph={graph}
            plan={plan}
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
