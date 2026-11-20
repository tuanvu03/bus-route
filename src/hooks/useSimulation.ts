import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_SIM_SPEED, STOP_DWELL_MS } from '../config';
import type { RouteGeometry, StopEvent } from '../lib/route';

export type SimStatus = 'idle' | 'running' | 'paused' | 'complete';

export interface SimulationSnapshot {
  status: SimStatus;
  distance: number;
  onboard: number;
  pickedUp: string[];
  pauseStop: StopEvent | null;
  delivered: number;
}

interface SimRefState {
  status: SimStatus;
  distance: number;
  onboard: number;
  pickedUp: Set<string>;
  pauseStop: StopEvent | null;
  delivered: number;
  nextEvent: number;
  pauseUntil: number;
}

const emptySnapshot = (): SimulationSnapshot => ({
  status: 'idle',
  distance: 0,
  onboard: 0,
  pickedUp: [],
  pauseStop: null,
  delivered: 0,
});

const emptyRef = (): SimRefState => ({
  status: 'idle',
  distance: 0,
  onboard: 0,
  pickedUp: new Set<string>(),
  pauseStop: null,
  delivered: 0,
  nextEvent: 0,
  pauseUntil: 0,
});

export function useSimulation(geometry: RouteGeometry | null) {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(emptySnapshot);
  const [speed, setSpeed] = useState(4);
  const stateRef = useRef<SimRefState>(emptyRef());
  const geometryRef = useRef<RouteGeometry | null>(geometry);
  const speedRef = useRef(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const publish = useCallback(() => {
    const s = stateRef.current;
    setSnapshot({
      status: s.status,
      distance: s.distance,
      onboard: s.onboard,
      pickedUp: [...s.pickedUp],
      pauseStop: s.pauseStop,
      delivered: s.delivered,
    });
  }, []);

  const resetInternal = useCallback(() => {
    stateRef.current = emptyRef();
  }, []);

  useEffect(() => {
    geometryRef.current = geometry;
    resetInternal();
    publish();
  }, [geometry, publish, resetInternal]);

  useEffect(() => {
    if (snapshot.status !== 'running') return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const s = stateRef.current;
      const geom = geometryRef.current;
      if (!geom || s.status !== 'running') return;

      if (s.pauseUntil > now) {
        publish();
        raf = requestAnimationFrame(tick);
        return;
      }
      if (s.pauseStop) {
        s.pauseStop = null;
        publish();
      }

      const dt = Math.min(0.12, (now - last) / 1000);
      last = now;
      let target = Math.min(
        geom.totalDistance,
        s.distance + dt * speedRef.current * BASE_SIM_SPEED,
      );
      let paused = false;

      while (s.nextEvent < geom.stopEvents.length) {
        const event = geom.stopEvents[s.nextEvent];
        if (event.at > target + 1e-7) break;
        s.nextEvent++;
        if (event.isDestination) {
          s.distance = geom.totalDistance;
          s.status = 'complete';
          s.pauseStop = null;
          s.delivered = geom.stopEvents
            .filter((e) => !e.isDestination)
            .reduce((sum, e) => sum + e.passengers, 0);
          publish();
          return;
        }
        s.distance = event.at;
        s.onboard += event.passengers;
        s.pickedUp.add(event.stopId);
        s.pauseUntil = now + STOP_DWELL_MS;
        s.pauseStop = event;
        paused = true;
        break;
      }

      if (!paused) s.distance = target;
      if (s.status === 'running' && s.distance >= geom.totalDistance - 1e-7) {
        s.distance = geom.totalDistance;
        s.status = 'complete';
        s.delivered = s.onboard;
        s.pauseStop = null;
      }
      publish();
      if (s.status === 'running') raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [snapshot.status, publish]);

  const play = useCallback(() => {
    const geom = geometryRef.current;
    if (!geom) return;
    const s = stateRef.current;
    if (s.status === 'complete' || s.status === 'idle') {
      stateRef.current = {
        ...emptyRef(),
        status: 'running',
      };
    } else {
      s.status = 'running';
    }
    publish();
  }, [publish]);

  const pause = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'running') return;
    s.status = 'paused';
    s.pauseStop = null;
    s.pauseUntil = 0;
    publish();
  }, [publish]);

  const reset = useCallback(() => {
    resetInternal();
    publish();
  }, [publish, resetInternal]);

  const seek = useCallback(
    (ratio: number) => {
      const geom = geometryRef.current;
      if (!geom) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      const target = clamped * geom.totalDistance;
      const s = stateRef.current;
      const wasRunning = s.status === 'running';
      let onboard = 0;
      const picked = new Set<string>();
      let nextEvent = 0;
      for (let i = 0; i < geom.stopEvents.length; i++) {
        const event = geom.stopEvents[i];
        if (event.isDestination) {
          if (target >= geom.totalDistance - 1e-7) nextEvent = i + 1;
          break;
        }
        if (event.at <= target + 1e-7) {
          onboard += event.passengers;
          picked.add(event.stopId);
          nextEvent = i + 1;
        } else {
          break;
        }
      }
      const atEnd = target >= geom.totalDistance - 1e-7;
      stateRef.current = {
        status: atEnd ? 'complete' : wasRunning ? 'running' : 'paused',
        distance: target,
        onboard,
        pickedUp: picked,
        pauseStop: null,
        delivered: atEnd ? onboard : 0,
        nextEvent,
        pauseUntil: 0,
      };
      publish();
    },
    [publish],
  );

  return {
    snapshot,
    speed,
    setSpeed,
    play,
    pause,
    reset,
    seek,
    canPlay: Boolean(geometry),
    progress: geometry && geometry.totalDistance > 0 ? snapshot.distance / geometry.totalDistance : 0,
  };
}
