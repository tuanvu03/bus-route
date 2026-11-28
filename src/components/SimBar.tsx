import { useRef } from 'react';
import type { RoutePlan, StopEvent } from '../lib/route';
import type { SimulationSnapshot } from '../hooks/useSimulation';
import { fmtMeters } from '../lib/format';
import { PauseIcon, PlayIcon, ResetIcon, SparkIcon } from './Icons';

interface SimBarProps {
  plan: RoutePlan | null;
  algorithmLabel: string | null;
  snapshot: SimulationSnapshot;
  speed: number;
  setSpeed: (speed: number) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (ratio: number) => void;
  nextEvent: StopEvent | null;
  currentLegIndex: number;
}

export function SimBar({
  plan,
  algorithmLabel,
  snapshot,
  speed,
  setSpeed,
  play,
  pause,
  reset,
  seek,
  nextEvent,
  currentLegIndex,
}: SimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  if (!plan) {
    return (
      <div className="simbar simbar-empty">
        <span className="simbar-empty-icon">
          <SparkIcon size={20} />
        </span>
        <div className="simbar-empty-copy">
          <strong>Select waiting stops, then run the optimiser</strong>
          <span>Route, distance matrix and the full Dijkstra log will appear here.</span>
        </div>
        <div className="simbar-steps" aria-hidden="true">
          <span><b>1</b> Pick</span>
          <i />
          <span><b>2</b> Run</span>
          <i />
          <span><b>3</b> Play</span>
        </div>
      </div>
    );
  }

  const { status, distance, onboard, pauseStop, delivered } = snapshot;
  const total = plan.geometry.totalDistance;
  const progress = total > 0 ? Math.min(1, distance / total) : 0;
  const leg = plan.legs[currentLegIndex] ?? plan.legs[plan.legs.length - 1];
  const legTarget = plan.points[leg.to].name;
  const running = status === 'running';
  const complete = status === 'complete';

  const scrub = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    seek((clientX - rect.left) / rect.width);
  };

  const statusText = complete
    ? `Complete · ${delivered} passengers delivered · ${algorithmLabel ?? 'route'}`
    : pauseStop
      ? `Picking up ${pauseStop.passengers} · ${pauseStop.name}`
      : status === 'paused'
        ? 'Paused'
        : status === 'idle'
          ? 'Ready to depart'
          : `En route to ${legTarget}`;

  return (
    <div className={`simbar ${complete ? 'is-complete' : ''}`}>
      <div className="sim-controls">
        <button type="button" className="sim-btn ghost" onClick={reset} aria-label="Reset simulation">
          <ResetIcon size={16} />
        </button>
        <button
          type="button"
          className="sim-btn primary"
          onClick={running ? pause : play}
          aria-label={running ? 'Pause simulation' : complete ? 'Replay simulation' : 'Play simulation'}
        >
          {running ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
        </button>
      </div>

      <div className="sim-main">
        <div className="sim-topline">
          <span className={`sim-status ${complete ? 'complete' : ''}`}>
            <i className={running ? 'pulse' : ''} />
            {statusText}
          </span>
          <span className="sim-next">
            {nextEvent
              ? `${fmtMeters(Math.max(0, nextEvent.at - distance))} to ${nextEvent.name}`
              : complete
                ? 'Destination reached'
                : `${fmtMeters(Math.max(0, total - distance))} remaining`}
          </span>
        </div>

        <div
          className="sim-track"
          ref={trackRef}
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic pointer events (tests) may not have an active pointer.
            }
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrub(e.clientX);
          }}
          role="slider"
          tabIndex={0}
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek(Math.min(1, progress + 0.02));
            if (e.key === 'ArrowLeft') seek(Math.max(0, progress - 0.02));
          }}
        >
          <div className="sim-track-fill" style={{ width: `${progress * 100}%` }} />
          {plan.geometry.stopEvents.map((event) => (
            <span
              key={`${event.stopId}-${event.at}`}
              className={`sim-tick ${event.isDestination ? 'dest' : ''} ${
                distance >= event.at - 0.5 ? 'passed' : ''
              }`}
              style={{ left: `${total > 0 ? (event.at / total) * 100 : 0}%` }}
              title={`${event.name} · ${fmtMeters(event.at)}`}
            />
          ))}
          <span className="sim-thumb" style={{ left: `${progress * 100}%` }} />
        </div>

        <div className="sim-bottomline">
          <span>
            {fmtMeters(distance)} <em>/</em> {fmtMeters(total)}
          </span>
          <span>
            Leg {currentLegIndex + 1}/{plan.legs.length} · stop {legTarget}
            {algorithmLabel ? ` · ${algorithmLabel}` : ''}
          </span>
        </div>
      </div>

      <div className="sim-side">
        <div className="onboard">
          <div className="onboard-label">
            <span>Onboard</span>
            <b className={onboard >= 20 ? 'full' : ''}>
              {onboard}
              <em>/20</em>
            </b>
          </div>
          <div className="onboard-meter" aria-hidden="true">
            {Array.from({ length: 20 }, (_, i) => (
              <span key={i} className={i < onboard ? 'on' : ''} />
            ))}
          </div>
        </div>
        <div className="speed-control">
          <span>Sim speed</span>
          <div className="speed-options">
            {[1, 2, 4, 8].map((value) => (
              <button
                type="button"
                key={value}
                className={speed === value ? 'active' : ''}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {pauseStop && (
        <div className="pickup-toast" key={pauseStop.stopId}>
          <span>+{pauseStop.passengers}</span>
          {pauseStop.name}
        </div>
      )}
    </div>
  );
}
