import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadGraph } from './lib/loadGraph';
import type { Graph, StopInfo } from './lib/types';
import { vertexCount } from './lib/types';
import {
  optimizeRoute,
  pointAtDistance,
  totalPassengers,
  type RoutePlan,
  type SelectedStop,
  type UnreachableInfo,
} from './lib/route';
import { frontierAtStep, reconstructPath } from './lib/dijkstra';
import { pointLabel } from './lib/labels';
import { MAX_STOPS } from './config';
import { useSimulation } from './hooks/useSimulation';
import { TopBar } from './components/TopBar';
import { Sidebar, type Notice } from './components/Sidebar';
import { MapView, type DijkstraMapView } from './components/MapView';
import { SimBar } from './components/SimBar';
import { Legend } from './components/Legend';
import { Inspector, type InspectorTab } from './components/Inspector';
import { CheckIcon, CloseIcon, RouteIcon } from './components/Icons';

const DEMO_STOPS: { id: string; passengers: number }[] = [
  { id: 'node/357826339', passengers: 3 }, // 공릉역1번출구
  { id: 'node/357821942', passengers: 2 }, // 서울과학기술대입구교차로
  { id: 'node/357826337', passengers: 4 }, // 공릉시장
  { id: 'node/357829497', passengers: 2 }, // 하계역3번출구.을지병원
  { id: 'node/357826081', passengers: 3 }, // 장위사거리
  { id: 'node/357821806', passengers: 2 }, // 태릉입구역3번출구
];

const TopBarMemo = memo(TopBar);

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedStop[]>([]);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [unreachable, setUnreachable] = useState<UnreachableInfo | null>(null);
  const [computeMs, setComputeMs] = useState<number | null>(null);
  const [solving, setSolving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<InspectorTab>('route');
  const [leg, setLeg] = useState<[number, number] | null>(null);
  const [step, setStep] = useState(0);
  const [showRoads, setShowRoads] = useState(true);
  const [follow, setFollow] = useState(true);
  const [completionDismissed, setCompletionDismissed] = useState(false);

  const selectedRef = useRef<SelectedStop[]>([]);
  selectedRef.current = selected;
  const noticeId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadGraph()
      .then((loaded) => {
        if (!cancelled) setGraph(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showNotice = useCallback((kind: Notice['kind'], text: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, kind, text });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const invalidateRoute = useCallback(() => {
    setPlan(null);
    setUnreachable(null);
    setComputeMs(null);
    setLeg(null);
    setStep(0);
    setCompletionDismissed(false);
  }, []);

  const toggleStop = useCallback(
    (stop: StopInfo) => {
      const current = selectedRef.current;
      const existing = current.find((s) => s.stop.id === stop.id);
      if (existing) {
        const next = current.filter((s) => s.stop.id !== stop.id);
        selectedRef.current = next;
        setSelected(next);
        invalidateRoute();
        return;
      }
      if (current.length >= MAX_STOPS) {
        showNotice('info', `You can select at most ${MAX_STOPS} stops for this MVP.`);
        return;
      }
      const next = [...current, { stop, passengers: 1 }];
      selectedRef.current = next;
      setSelected(next);
      invalidateRoute();
    },
    [invalidateRoute, showNotice],
  );

  const updatePassengers = useCallback(
    (id: string, value: number) => {
      const next = selectedRef.current.map((s) =>
        s.stop.id === id
          ? {
              ...s,
              passengers: Math.max(1, Math.min(20, Number.isFinite(value) ? Math.round(value) : 1)),
            }
          : s,
      );
      selectedRef.current = next;
      setSelected(next);
      invalidateRoute();
    },
    [invalidateRoute],
  );

  const removeStop = useCallback(
    (id: string) => {
      const next = selectedRef.current.filter((s) => s.stop.id !== id);
      selectedRef.current = next;
      setSelected(next);
      invalidateRoute();
    },
    [invalidateRoute],
  );

  const clearStops = useCallback(() => {
    selectedRef.current = [];
    setSelected([]);
    invalidateRoute();
  }, [invalidateRoute]);

  const loadDemo = useCallback(() => {
    if (!graph) return;
    const next: SelectedStop[] = [];
    for (const spec of DEMO_STOPS) {
      const stop = graph.stops.find((s) => s.id === spec.id);
      if (stop) next.push({ stop, passengers: spec.passengers });
    }
    selectedRef.current = next;
    setSelected(next);
    invalidateRoute();
    showNotice('info', 'Loaded a six-stop demo trip (16 passengers).');
  }, [graph, invalidateRoute, showNotice]);

  const total = useMemo(() => totalPassengers(selected), [selected]);
  const capacityOk = total <= 20;
  const canRun = Boolean(graph) && selected.length > 0 && capacityOk && !solving;

  const runOptimization = useCallback(() => {
    if (!graph) return;
    const current = selectedRef.current;
    const currentTotal = totalPassengers(current);
    if (current.length === 0 || currentTotal > 20) return;
    setSolving(true);
    setNotice(null);
    window.setTimeout(() => {
      const started = performance.now();
      const result = optimizeRoute(graph, current);
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      setComputeMs(elapsed);
      setPlan(result.plan);
      setUnreachable(result.unreachable);
      setSolving(false);
      setCompletionDismissed(false);
      if (result.plan) {
        setTab('route');
        setLeg([result.plan.order[0], result.plan.order[1]]);
        setStep(0);
      } else {
        setTab('route');
        setLeg(null);
        setStep(0);
      }
    }, 30);
  }, [graph]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (canRun) runOptimization();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRun, runOptimization]);

  const chooseLeg = useCallback((from: number, to: number) => {
    setLeg([from, to]);
    setStep(0);
    setTab('dijkstra');
  }, []);

  const visitOrder = useMemo(() => {
    const map = new Map<string, number>();
    if (plan) {
      plan.order.slice(1, -1).forEach((pointIndex, i) => {
        const stop = plan.points[pointIndex].stop;
        if (stop) map.set(stop.id, i + 1);
      });
    }
    return map;
  }, [plan]);

  const sim = useSimulation(plan?.geometry ?? null);
  const busPoint = plan ? pointAtDistance(plan.geometry, sim.snapshot.distance) : null;
  const busCoord = busPoint?.coord ?? null;
  const nextEvent = plan
    ? plan.geometry.stopEvents.find((event) => event.at > sim.snapshot.distance + 0.5) ?? null
    : null;

  useEffect(() => {
    if (sim.snapshot.status !== 'complete') setCompletionDismissed(false);
  }, [sim.snapshot.status]);

  const dijkstra = useMemo<DijkstraMapView | null>(() => {
    if (!graph || !plan || tab !== 'dijkstra' || !leg) return null;
    const run = plan.runs[leg[0]];
    if (!run) return null;
    const target = plan.points[leg[1]];
    const clamped = Math.max(0, Math.min(step, run.steps.length));
    const current = clamped > 0 ? run.steps[clamped - 1] : null;
    const frontier = frontierAtStep(
      graph.adj,
      vertexCount(graph),
      run.source,
      run.steps,
      clamped,
    );
    return {
      sourceVertex: run.source,
      targetVertex: target.vertex,
      settledVertex: current?.vertex ?? null,
      frontier: frontier.entries,
      relaxed: current?.relaxed ?? [],
      path: reconstructPath(run, target.vertex) ?? [],
      stepIndex: clamped,
      stepCount: run.steps.length,
    };
  }, [graph, plan, tab, leg, step]);

  if (loadError) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <span className="boot-icon danger">
            <CloseIcon size={22} />
          </span>
          <h1>Graph could not be loaded</h1>
          <p>{loadError}</p>
          <code>npm run build:graph</code>
        </div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="boot-screen">
        <div className="boot-loading">
          <span className="boot-icon">
            <RouteIcon size={24} />
          </span>
          <h1>Campus Loop</h1>
          <p>Loading the drivable road graph…</p>
          <span className="boot-bar" />
        </div>
      </div>
    );
  }

  const showCompletion =
    plan && sim.snapshot.status === 'complete' && !completionDismissed;

  return (
    <div className="app">
      <TopBarMemo meta={graph.meta} />

      <div className="workspace">
        <Sidebar
          graph={graph}
          selected={selected}
          visitOrder={visitOrder}
          totalPassengers={total}
          notice={notice}
          error={unreachable?.message ?? null}
          solving={solving}
          onToggleStop={toggleStop}
          onPassengers={updatePassengers}
          onRemove={removeStop}
          onClear={clearStops}
          onDemo={loadDemo}
          onRun={runOptimization}
        />

        <section className="stage">
          <div className="map-shell">
            <MapView
              graph={graph}
              selected={selected}
              plan={plan}
              dijkstra={dijkstra}
              busCoord={busCoord}
              busLegIndex={busPoint?.legIndex ?? 0}
              showBus={tab !== 'dijkstra'}
              onboard={sim.snapshot.onboard}
              pickedUp={sim.snapshot.pickedUp}
              follow={follow}
              showRoads={showRoads}
              onToggleStop={toggleStop}
              onToggleRoads={() => setShowRoads((v) => !v)}
              onToggleFollow={() => setFollow((v) => !v)}
            />

            <div className="map-overlay-layer">
              <Legend plan={plan} dijkstra={dijkstra} activeTab={tab} />
            </div>

            {showCompletion && plan && (
              <div className="completion-card" role="status">
                <span className="completion-check">
                  <CheckIcon size={18} />
                </span>
                <div className="completion-copy">
                  <strong>Route complete</strong>
                  <span>
                    {plan.totalDistance >= 1000
                      ? `${(plan.totalDistance / 1000).toFixed(2)} km`
                      : `${plan.totalDistance.toFixed(0)} m`}{' '}
                    · {plan.order.length - 2} stops · {sim.snapshot.delivered} passengers delivered
                  </span>
                  <em>
                    {plan.order
                      .map((point) => pointLabel(point, plan.points.length))
                      .join(' → ')}
                  </em>
                </div>
                <button
                  type="button"
                  className="completion-close"
                  onClick={() => setCompletionDismissed(true)}
                  aria-label="Dismiss completion summary"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            )}

            <SimBar
              plan={plan}
              snapshot={sim.snapshot}
              speed={sim.speed}
              setSpeed={sim.setSpeed}
              play={sim.play}
              pause={sim.pause}
              reset={sim.reset}
              seek={sim.seek}
              nextEvent={nextEvent}
              currentLegIndex={busPoint?.legIndex ?? 0}
            />
          </div>
        </section>

        <Inspector
          graph={graph}
          plan={plan}
          unreachable={unreachable}
          selected={selected}
          computeMs={computeMs}
          tab={tab}
          leg={leg}
          step={step}
          onTabChange={setTab}
          onLegChange={chooseLeg}
          onStepChange={setStep}
        />
      </div>
    </div>
  );
}
