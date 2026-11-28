import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadGraph } from './lib/loadGraph';
import type { Graph, SerializedGraph, StopInfo } from './lib/types';
import { vertexCount } from './lib/types';
import {
  pointAtDistance,
  selectionCapacityError,
  solveRoute,
  totalPassengers,
  type AlgorithmMode,
  type RoutePlan,
  type SelectedStop,
  type SolveProgress,
  type SolveResult,
  type UnreachableInfo,
} from './lib/route';
import { dijkstra, frontierAtStep, reconstructPath, type DijkstraResult } from './lib/dijkstra';
import { pointLabel } from './lib/labels';
import {
  BUS_CAPACITY,
  DEFAULT_SCENARIO_SEED,
  HELD_KARP_HARD_LIMIT,
  HELD_KARP_MAX_STOPS,
} from './config';
import { useSimulation } from './hooks/useSimulation';
import { computeCandidateStops, generateScenario, type CandidateSet } from './lib/scenario';
import { deriveScenarioSeed, parseSeed } from './lib/random';
import presetsData from '../presets.json';
import { TopBar } from './components/TopBar';
import { Sidebar, type Notice, type PresetScenario } from './components/Sidebar';
import { MapView, type DijkstraMapView } from './components/MapView';
import { SimBar } from './components/SimBar';
import { Legend } from './components/Legend';
import { Inspector, type InspectorTab } from './components/Inspector';
import { BenchmarkPanel, type BenchmarkLoadRequest } from './components/BenchmarkPanel';
import { CheckIcon, CloseIcon, RouteIcon } from './components/Icons';

const DEMO_STOPS: { id: string; passengers: number }[] = [
  { id: 'node/357826339', passengers: 3 }, // 공릉역1번출구
  { id: 'node/357821942', passengers: 2 }, // 서울과학기술대입구교차로
  { id: 'node/357826337', passengers: 4 }, // 공릉시장
  { id: 'node/357829497', passengers: 2 }, // 하계역3번출구.을지병원
  { id: 'node/357826081', passengers: 3 }, // 장위사거리
  { id: 'node/357821806', passengers: 2 }, // 태릉입구역3번출구
];

const PRESETS = (presetsData as { presets: PresetScenario[] }).presets;

const TopBarMemo = memo(TopBar);

type View = 'simulator' | 'benchmark';
type AnimMode = 'greedy' | 'optimal';

interface SolverResultMessage {
  type: 'result';
  requestId: number;
  result: SolveResult;
}

interface SolverProgressMessage {
  type: 'progress';
  requestId: number;
  progress: SolveProgress;
}

function serializeGraph(graph: Graph): SerializedGraph {
  return {
    meta: graph.meta,
    vertices: Array.from(graph.coords),
    adj: graph.adj.map((list) => list.map(([to, weight]) => [to, weight])),
    stops: graph.stops,
    start: graph.start,
    destination: graph.destination,
    roads: graph.roads,
  };
}

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedStop[]>([]);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [unreachable, setUnreachable] = useState<UnreachableInfo | null>(null);
  const [solving, setSolving] = useState(false);
  const [solveProgress, setSolveProgress] = useState<SolveProgress | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<InspectorTab>('route');
  const [leg, setLeg] = useState<[number, number] | null>(null);
  const [step, setStep] = useState(0);
  const [showRoads, setShowRoads] = useState(true);
  const [follow, setFollow] = useState(true);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [mode, setMode] = useState<AlgorithmMode>('compare');
  const [hkLimit, setHkLimit] = useState(HELD_KARP_MAX_STOPS);
  const [animMode, setAnimMode] = useState<AnimMode>('optimal');
  const [routeVisibility, setRouteVisibility] = useState({ greedy: true, optimal: true });
  const [view, setView] = useState<View>('simulator');
  const [candidates, setCandidates] = useState<CandidateSet | null>(null);
  const [legRun, setLegRun] = useState<{ key: string; run: DijkstraResult } | null>(null);
  const [legLoading, setLegLoading] = useState(false);

  const selectedRef = useRef<SelectedStop[]>([]);
  selectedRef.current = selected;
  const noticeId = useRef(0);
  const solverRef = useRef<Worker | null>(null);
  const solverReady = useRef(false);
  const requestSeq = useRef(0);
  const activeRequest = useRef(0);

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

  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setCandidates(computeCandidateStops(graph));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [graph]);

  const showNotice = useCallback((kind: Notice['kind'], text: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, kind, text });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const invalidateRoute = useCallback(() => {
    setResult(null);
    setUnreachable(null);
    setLeg(null);
    setStep(0);
    setLegRun(null);
    setCompletionDismissed(false);
  }, []);

  const applyResult = useCallback((next: SolveResult) => {
    setResult(next);
    setUnreachable(next.unreachable);
    setSolving(false);
    setSolveProgress(null);
    setCompletionDismissed(false);
    setTab('route');
    if (next.plan) {
      setLeg([next.plan.order[0], next.plan.order[1]]);
      setStep(0);
      setAnimMode(next.mode === 'greedy' ? 'greedy' : 'optimal');
    } else {
      setLeg(null);
      setStep(0);
    }
    if (next.warnings.length > 0) {
      showNotice('info', next.warnings[0]);
    }
  }, [showNotice]);

  const startSolverWorker = useCallback(() => {
    if (!graph || typeof Worker === 'undefined') return;
    solverRef.current?.terminate();
    solverReady.current = false;
    const worker = new Worker(new URL('./workers/solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'ready' }
        | SolverProgressMessage
        | SolverResultMessage
        | { type: 'error'; requestId: number; message: string };
      if (message.type === 'ready') {
        solverReady.current = true;
        return;
      }
      if (message.type === 'progress') {
        if (message.requestId === activeRequest.current) setSolveProgress(message.progress);
        return;
      }
      if (message.type === 'result') {
        if (message.requestId === activeRequest.current) applyResult(message.result);
        return;
      }
      if (message.type === 'error') {
        if (message.requestId === activeRequest.current) {
          setSolving(false);
          setSolveProgress(null);
          showNotice('error', message.message);
        }
      }
    };
    worker.onerror = (event) => {
      setSolving(false);
      setSolveProgress(null);
      showNotice('error', event.message || 'Solver worker failed');
    };
    worker.postMessage({ type: 'init', graph: serializeGraph(graph) });
    solverRef.current = worker;
  }, [graph, applyResult, showNotice]);

  useEffect(() => {
    startSolverWorker();
    return () => {
      solverRef.current?.terminate();
      solverRef.current = null;
      solverReady.current = false;
    };
  }, [startSolverWorker]);

  const toggleStop = useCallback(
    (stop: StopInfo) => {
      const current = selectedRef.current;
      const existing = current.find((s) => s.stop.id === stop.id);
      const next = existing
        ? current.filter((s) => s.stop.id !== stop.id)
        : [...current, { stop, passengers: 1 }];
      selectedRef.current = next;
      setSelected(next);
      invalidateRoute();
    },
    [invalidateRoute],
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

  const total = useMemo(() => totalPassengers(selected), [selected]);
  const capacityOk = selectionCapacityError(selected) === null;
  const canRun = Boolean(graph) && selected.length > 0 && capacityOk && !solving;

  const runOptimization = useCallback(
    (overrides: { mode?: AlgorithmMode } = {}) => {
      if (!graph) return;
      const current = selectedRef.current;
      const currentTotal = totalPassengers(current);
      if (current.length === 0 || currentTotal > BUS_CAPACITY) return;
      const runMode = overrides.mode ?? mode;
      setSolving(true);
      setNotice(null);
      setSolveProgress({
        phase: 'matrix',
        progress: 0,
        detail: `Building ${current.length + 1} Dijkstra searches`,
      });
      setCompletionDismissed(false);
      const requestId = ++requestSeq.current;
      activeRequest.current = requestId;

      if (solverRef.current && solverReady.current) {
        solverRef.current.postMessage({
          type: 'solve',
          requestId,
          selected: current,
          mode: runMode,
          hkLimit,
        });
        return;
      }

      // Fallback for environments without a module worker (e.g. older test
      // harnesses). The same pure solver is used on the main thread.
      window.setTimeout(() => {
        if (activeRequest.current !== requestId) return;
        try {
          const next = solveRoute(graph, current, { mode: runMode, hkLimit });
          applyResult(next);
        } catch (error) {
          setSolving(false);
          setSolveProgress(null);
          showNotice('error', error instanceof Error ? error.message : String(error));
        }
      }, 30);
    },
    [applyResult, graph, hkLimit, mode, showNotice],
  );

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
    setMode('compare');
    showNotice('info', 'Loaded a six-stop demo trip (16 passengers) in Compare mode.');
    window.setTimeout(() => runOptimization({ mode: 'compare' }), 0);
  }, [graph, invalidateRoute, runOptimization, showNotice]);

  const cancelSolve = useCallback(() => {
    activeRequest.current = 0;
    setSolving(false);
    setSolveProgress(null);
    startSolverWorker();
    showNotice('info', 'Optimisation cancelled.');
  }, [showNotice, startSolverWorker]);

  const handleRandom = useCallback(
    (k: number, seedText: string) => {
      if (!candidates) return;
      const seed = parseSeed(seedText);
      try {
        const scenario = generateScenario(candidates.stops, k, seed, 1);
        selectedRef.current = scenario.stops;
        setSelected(scenario.stops);
        invalidateRoute();
        const scenarioTotal = totalPassengers(scenario.stops);
        if (scenarioTotal > BUS_CAPACITY) {
          showNotice(
            'info',
            `Random scenario needs ${scenarioTotal} passengers but the bus capacity is ${BUS_CAPACITY}. The run is blocked; reduce k or edit passenger counts.`,
          );
          return;
        }
        showNotice('info', `Generated ${k} stops from seed ${seed >>> 0}.`);
        window.setTimeout(() => runOptimization(), 0);
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : String(error));
      }
    },
    [candidates, invalidateRoute, runOptimization, showNotice],
  );

  const loadPreset = useCallback(
    (preset: PresetScenario) => {
      if (!graph) return;
      const next: SelectedStop[] = [];
      for (const id of preset.stopIds) {
        const stop = graph.stops.find((s) => s.id === id);
        if (stop) next.push({ stop, passengers: preset.passengers ?? 1 });
      }
      if (next.length !== preset.stopIds.length) {
        showNotice('error', `Preset "${preset.name}" references a stop that is not on this map.`);
        return;
      }
      selectedRef.current = next;
      setSelected(next);
      invalidateRoute();
      setMode('compare');
      showNotice(
        'info',
        `Loaded "${preset.name}" (k=${preset.k}, measured gap ${preset.gapMeters.toFixed(1)} m / ${preset.gapPct.toFixed(2)}%).`,
      );
      window.setTimeout(() => runOptimization({ mode: 'compare' }), 0);
    },
    [graph, invalidateRoute, runOptimization, showNotice],
  );

  const loadBenchmarkScenario = useCallback(
    (request: BenchmarkLoadRequest) => {
      if (!candidates) return;
      try {
        // Reproduce via the benchmark base seed + k + scenario index, then
        // verify against the stop ids recorded by the benchmark.
        const derivedSeed = deriveScenarioSeed(request.baseSeed, request.k, request.index);
        const scenario = generateScenario(
          candidates.stops,
          request.k,
          derivedSeed,
          request.passengers,
        );
        if (request.stopIds && request.stopIds.length > 0) {
          const actual = scenario.stops.map((s) => s.stop.id).sort();
          const expected = [...request.stopIds].sort();
          if (actual.join('|') !== expected.join('|')) {
            showNotice('error', 'Scenario reproduction failed: stop ids did not match.');
            return;
          }
        }
        selectedRef.current = scenario.stops;
        setSelected(scenario.stops);
        invalidateRoute();
        setView('simulator');
        setMode('compare');
        setAnimMode('optimal');
        showNotice('info', `Loaded benchmark scenario k=${request.k}, seed=${request.seed}.`);
        window.setTimeout(() => runOptimization({ mode: 'compare' }), 0);
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : String(error));
      }
    },
    [candidates, invalidateRoute, runOptimization, showNotice],
  );

  const changeMode = useCallback(
    (next: AlgorithmMode) => {
      if (solving) cancelSolve();
      setMode(next);
      invalidateRoute();
    },
    [cancelSolve, invalidateRoute, solving],
  );

  const changeHkLimit = useCallback(
    (value: number) => {
      if (solving) cancelSolve();
      const clamped = Math.max(1, Math.min(HELD_KARP_HARD_LIMIT, Math.round(value)));
      setHkLimit(clamped);
      invalidateRoute();
      if (clamped > HELD_KARP_MAX_STOPS) {
        showNotice(
          'info',
          `Held-Karp limit raised to ${clamped}. Large n can be slow and may exhaust browser memory.`,
        );
      }
    },
    [cancelSolve, invalidateRoute, showNotice, solving],
  );

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
      if (canRun && view === 'simulator') runOptimization();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRun, runOptimization, view]);

  const chooseLeg = useCallback((from: number, to: number) => {
    setLeg([from, to]);
    setStep(0);
    setTab('dijkstra');
  }, []);

  const greedyPlan = result?.greedy ?? null;
  const optimalPlan = result?.optimal ?? null;
  const primaryPlan = result?.plan ?? null;
  const animationPlan = useMemo<RoutePlan | null>(() => {
    if (!result) return null;
    if (result.mode === 'greedy') return result.greedy;
    if (result.mode === 'held-karp') return result.optimal;
    return animMode === 'greedy' ? result.greedy : result.optimal;
  }, [result, animMode]);

  const visitOrder = useMemo(() => {
    const map = new Map<string, number>();
    if (animationPlan) {
      animationPlan.order.slice(1, -1).forEach((pointIndex, i) => {
        const stop = animationPlan.points[pointIndex].stop;
        if (stop) map.set(stop.id, i + 1);
      });
    }
    return map;
  }, [animationPlan]);

  const sim = useSimulation(animationPlan?.geometry ?? null);
  const busPoint = animationPlan
    ? pointAtDistance(animationPlan.geometry, sim.snapshot.distance)
    : null;
  const busCoord = busPoint?.coord ?? null;
  const nextEvent = animationPlan
    ? animationPlan.geometry.stopEvents.find((event) => event.at > sim.snapshot.distance + 0.5) ?? null
    : null;

  useEffect(() => {
    if (sim.snapshot.status !== 'complete') setCompletionDismissed(false);
  }, [sim.snapshot.status]);

  useEffect(() => {
    if (!graph || !result || tab !== 'dijkstra' || !leg) {
      setLegRun(null);
      setLegLoading(false);
      return;
    }
    const key = `${leg[0]}:${leg[1]}`;
    const point = result.points[leg[0]];
    if (!point) return;
    let cancelled = false;
    setLegLoading(true);
    const timer = window.setTimeout(() => {
      const run = dijkstra(graph.adj, vertexCount(graph), point.vertex);
      if (!cancelled) {
        setLegRun({ key, run });
        setLegLoading(false);
      }
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [graph, result, tab, leg]);

  const dijkstraView = useMemo<DijkstraMapView | null>(() => {
    if (!graph || !result || tab !== 'dijkstra' || !leg || !legRun) return null;
    if (legRun.key !== `${leg[0]}:${leg[1]}`) return null;
    const run = legRun.run;
    const target = result.points[leg[1]];
    if (!target) return null;
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
  }, [graph, result, tab, leg, step, legRun]);

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

  const showCompletion = Boolean(animationPlan) && sim.snapshot.status === 'complete' && !completionDismissed;

  return (
    <div className="app">
      <TopBarMemo
        meta={graph.meta}
        view={view}
        onViewChange={setView}
        mode={mode}
      />

      {view === 'benchmark' ? (
        <BenchmarkPanel
          graph={graph}
          candidates={candidates}
          onLoadScenario={loadBenchmarkScenario}
        />
      ) : (
        <div className="workspace">
          <Sidebar
            graph={graph}
            selected={selected}
            visitOrder={visitOrder}
            totalPassengers={total}
            notice={notice}
            error={unreachable?.message ?? null}
            solving={solving}
            progress={solveProgress}
            mode={mode}
            hkLimit={hkLimit}
            candidates={candidates}
            presets={PRESETS}
            defaultSeed={DEFAULT_SCENARIO_SEED}
            onToggleStop={toggleStop}
            onPassengers={updatePassengers}
            onRemove={removeStop}
            onClear={clearStops}
            onDemo={loadDemo}
            onRun={() => runOptimization()}
            onCancel={cancelSolve}
            onModeChange={changeMode}
            onHkLimitChange={changeHkLimit}
            onRandom={handleRandom}
            onPreset={loadPreset}
          />

          <section className="stage">
            <div className="map-shell">
              <MapView
                graph={graph}
                selected={selected}
                plan={animationPlan}
                greedyPlan={greedyPlan}
                optimalPlan={optimalPlan}
                comparison={result?.comparison ?? null}
                mode={mode}
                animMode={animMode}
                routeVisibility={routeVisibility}
                onToggleRoute={(target) =>
                  setRouteVisibility((current) => ({ ...current, [target]: !current[target] }))
                }
                dijkstra={dijkstraView}
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
                <Legend
                  plan={animationPlan}
                  greedyPlan={greedyPlan}
                  optimalPlan={optimalPlan}
                  comparison={result?.comparison ?? null}
                  mode={mode}
                  routeVisibility={routeVisibility}
                  onToggleRoute={(target) =>
                    setRouteVisibility((current) => ({ ...current, [target]: !current[target] }))
                  }
                  dijkstra={dijkstraView}
                  activeTab={tab}
                />
              </div>

              {showCompletion && animationPlan && (
                <div className="completion-card" role="status">
                  <span className="completion-check">
                    <CheckIcon size={18} />
                  </span>
                  <div className="completion-copy">
                    <strong>Route complete · {animationPlan.algorithmLabel}</strong>
                    <span>
                      {animationPlan.totalDistance >= 1000
                        ? `${(animationPlan.totalDistance / 1000).toFixed(2)} km`
                        : `${animationPlan.totalDistance.toFixed(0)} m`}{' '}
                      · {animationPlan.order.length - 2} stops · {sim.snapshot.delivered} passengers delivered
                    </span>
                    <em>
                      {animationPlan.order
                        .map((point) => pointLabel(point, animationPlan.points.length))
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
                plan={animationPlan}
                algorithmLabel={animationPlan?.algorithmLabel ?? null}
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
            result={result}
            plan={primaryPlan}
            unreachable={unreachable}
            selected={selected}
            mode={mode}
            animMode={animMode}
            tab={tab}
            leg={leg}
            step={step}
            run={legRun?.key === (leg ? `${leg[0]}:${leg[1]}` : '') ? legRun?.run ?? null : null}
            legLoading={legLoading}
            onTabChange={setTab}
            onLegChange={chooseLeg}
            onStepChange={setStep}
            onAnimModeChange={setAnimMode}
          />
        </div>
      )}
    </div>
  );
}
