/**
 * Benchmark Web Worker.
 *
 * All Dijkstra cache construction and every scenario run happen off the main
 * thread. Per-k summaries are posted as soon as they are ready so the table
 * fills incrementally.
 */
import {
  runBenchmark,
  type BenchmarkConfig,
  type BenchmarkProgress,
} from '../lib/benchmark';
import type { Edge, Graph, SerializedGraph, StopInfo } from '../lib/types';

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
        type: 'run';
        candidates: StopInfo[];
        config: BenchmarkConfig;
      };

  if (message.type === 'init') {
    graph = hydrate(message.graph);
    post({ type: 'ready' });
    return;
  }

  if (message.type !== 'run') return;
  if (!graph) {
    post({ type: 'error', message: 'Benchmark worker has no graph' });
    return;
  }

  let lastPost = 0;
  const onProgress = (progress: BenchmarkProgress) => {
    const now = performance.now();
    if (progress.progress < 1 && now - lastPost < 100) return;
    lastPost = now;
    post({ type: 'progress', progress });
  };

  try {
    const result = runBenchmark(
      graph,
      message.candidates,
      message.config,
      onProgress,
      (summary) => post({ type: 'summary', summary }),
    );
    post({ type: 'done', result });
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
