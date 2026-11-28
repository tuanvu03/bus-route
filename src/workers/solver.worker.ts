/**
 * Solver Web Worker.
 *
 * The UI sends the graph once, then one solve request at a time. Held-Karp and
 * the heuristic run here so the main thread (map, animation, inputs) never
 * freezes. Cancellation is implemented by terminating this worker from the
 * main thread and creating a fresh one.
 */
import { solveRoute, type AlgorithmMode, type SelectedStop, type SolveProgress } from '../lib/route';
import type { Edge, Graph, SerializedGraph } from '../lib/types';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
}

const scope = self as unknown as WorkerScope;

let graph: Graph | null = null;

function hydrate(raw: SerializedGraph): Graph {
  return {
    meta: raw.meta,
    coords: new Float64Array(raw.vertices),
    adj: raw.adj.map((list) => list.map(([to, weight]) => [to, weight] as Edge)),
    stops: raw.stops,
    start: raw.start,
    destination: raw.destination,
    roads: raw.roads ?? [],
  };
}

function post(message: unknown) {
  scope.postMessage(message);
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as
    | { type: 'init'; graph: SerializedGraph }
    | {
        type: 'solve';
        requestId: number;
        selected: SelectedStop[];
        mode: AlgorithmMode;
        hkLimit: number;
      };

  if (message.type === 'init') {
    graph = hydrate(message.graph);
    post({ type: 'ready' });
    return;
  }

  if (message.type !== 'solve') return;
  if (!graph) {
    post({ type: 'error', requestId: message.requestId, message: 'Solver worker has no graph' });
    return;
  }

  const { requestId, selected, mode, hkLimit } = message;
  let lastPost = 0;
  let lastPhase = '';

  const onProgress = (progress: SolveProgress) => {
    const now = performance.now();
    const phaseChanged = progress.phase !== lastPhase;
    if (!phaseChanged && progress.progress < 1 && now - lastPost < 90) return;
    lastPost = now;
    lastPhase = progress.phase;
    post({ type: 'progress', requestId, progress });
  };

  try {
    const result = solveRoute(graph, selected, { mode, hkLimit, onProgress });
    post({ type: 'result', requestId, result });
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
