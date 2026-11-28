import type { GraphMeta } from '../lib/types';
import { fmtNumber } from '../lib/format';
import type { AlgorithmMode } from '../lib/route';
import { RouteIcon } from './Icons';

const MODE_LABEL: Record<AlgorithmMode, string> = {
  greedy: 'Mode A · greedy',
  'held-karp': 'Mode B · Held-Karp',
  compare: 'Mode C · compare',
};

export function TopBar({
  meta,
  view,
  onViewChange,
  mode,
}: {
  meta: GraphMeta;
  view: 'simulator' | 'benchmark';
  onViewChange: (view: 'simulator' | 'benchmark') => void;
  mode: AlgorithmMode;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <RouteIcon size={22} />
        </div>
        <div className="brand-text">
          <h1>Campus Loop</h1>
          <p>SNUST pickup route lab</p>
        </div>
      </div>

      <nav className="view-switch" aria-label="Application view">
        <button
          type="button"
          className={view === 'simulator' ? 'active' : ''}
          onClick={() => onViewChange('simulator')}
        >
          Simulator
        </button>
        <button
          type="button"
          className={view === 'benchmark' ? 'active' : ''}
          onClick={() => onViewChange('benchmark')}
        >
          Benchmark
        </button>
      </nav>

      <div className="topbar-stats" aria-label="Graph statistics">
        <div className="stat">
          <b>{fmtNumber(meta.vertexCount)}</b>
          <span>vertices</span>
        </div>
        <div className="stat">
          <b>{fmtNumber(meta.edgeCount)}</b>
          <span>directed edges</span>
        </div>
        <div className="stat">
          <b>{fmtNumber(meta.stopCount)}</b>
          <span>bus stops</span>
        </div>
        <div className="stat stat-oneway">
          <b>{fmtNumber(meta.oneWaySegmentCount)}</b>
          <span>one-way segments</span>
        </div>
      </div>

      <div className="topbar-right">
        <span className="engine-badge">
          <span className="status-dot" />
          {view === 'simulator' ? MODE_LABEL[mode] : 'Benchmark · seeded'}
        </span>
        <span className="source-badge">OSM · Nowon-gu</span>
      </div>
    </header>
  );
}
