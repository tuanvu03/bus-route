import type { GraphMeta } from '../lib/types';
import { fmtNumber } from '../lib/format';
import { RouteIcon } from './Icons';

export function TopBar({ meta }: { meta: GraphMeta }) {
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
          Dijkstra · Held-Karp
        </span>
        <span className="source-badge">OSM · Nowon-gu</span>
      </div>
    </header>
  );
}
