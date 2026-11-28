import { describe, expect, it } from 'vitest';
import { BUS_CAPACITY } from '../src/config';
import {
  buildDistanceCache,
  runBenchmark,
  runScenario,
  summarize,
} from '../src/lib/benchmark';
import { selectionCapacityError, solveRoute, totalPassengers } from '../src/lib/route';
import { computeCandidateStops, generateScenario } from '../src/lib/scenario';
import { deriveScenarioSeed } from '../src/lib/random';
import presetsData from '../presets.json';
import { loadGraphFromDisk } from './helpers';

const graph = loadGraphFromDisk();
const candidates = computeCandidateStops(graph);

describe('random scenarios', () => {
  it('builds a deduplicated, reachable candidate set', () => {
    expect(candidates.stops.length).toBeGreaterThan(100);
    expect(candidates.mergedCount).toBeGreaterThan(0);
    expect(candidates.unreachableCount).toBeGreaterThan(0);
    expect(
      candidates.stops.length + candidates.mergedCount + candidates.unreachableCount,
    ).toBe(candidates.totalStops);
    expect(new Set(candidates.stops.map((stop) => stop.vertex)).size).toBe(
      candidates.stops.length,
    );
  });

  it('reproduces the same stops and route from the same seed', () => {
    const seed = deriveScenarioSeed(123456, 8, 3);
    const first = generateScenario(candidates.stops, 8, seed, 1);
    const second = generateScenario(candidates.stops, 8, seed, 1);
    expect(second.stops.map((s) => s.stop.id)).toEqual(first.stops.map((s) => s.stop.id));

    const a = solveRoute(graph, first.stops, { mode: 'compare', hkLimit: 15 });
    const b = solveRoute(graph, second.stops, { mode: 'compare', hkLimit: 15 });
    expect(a.comparison).not.toBeNull();
    expect(b.comparison).not.toBeNull();
    expect(a.comparison!.greedy.totalDistance).toBeCloseTo(
      b.comparison!.greedy.totalDistance,
      6,
    );
    expect(a.comparison!.optimal.totalDistance).toBeCloseTo(
      b.comparison!.optimal.totalDistance,
      6,
    );
    expect(a.optimal!.order).toEqual(b.optimal!.order);
  });

  it('enforces the 20-passenger capacity and keeps the existing message', () => {
    const scenario = generateScenario(candidates.stops, 21, 777, 1);
    expect(scenario.stops).toHaveLength(21);
    expect(totalPassengers(scenario.stops)).toBeGreaterThan(BUS_CAPACITY);
    expect(selectionCapacityError(scenario.stops)).toBe(
      'Total passengers exceed the bus capacity by 1.',
    );

    const allowed = generateScenario(candidates.stops, 20, 777, 1);
    expect(selectionCapacityError(allowed.stops)).toBeNull();
  });
});

describe('benchmark harness', () => {
  const config = {
    kValues: [3, 4, 5, 6],
    scenariosPerK: 4,
    baseSeed: 424242,
    passengersPerStop: 1,
    hkLimit: 15,
  };

  it('is reproducible and never reports exact > greedy', () => {
    const first = runBenchmark(graph, candidates.stops, config);
    const second = runBenchmark(graph, candidates.stops, config);
    expect(first.summaries).toHaveLength(config.kValues.length);
    expect(first.violations).toBe(0);
    expect(first.skipped).toBe(0);

    const signature = (result: typeof first) =>
      result.summaries.map((summary) =>
        summary.scenarios.map((scenario) => ({
          seed: scenario.seed,
          stops: scenario.stopIds,
          greedy: scenario.greedyDistance,
          optimal: scenario.optimalDistance,
          order: scenario.optimalOrder,
        })),
      );
    expect(signature(second)).toEqual(signature(first));

    for (const summary of first.summaries) {
      expect(summary.algorithm).toBe('exact');
      for (const scenario of summary.scenarios) {
        expect(scenario.optimalDistance).toBeLessThanOrEqual(
          scenario.greedyDistance + 1e-6,
        );
      }
    }
  });

  it('restores a benchmark scenario exactly via its seed and index', () => {
    const config = {
      kValues: [6],
      scenariosPerK: 3,
      baseSeed: 998877,
      passengersPerStop: 1,
      hkLimit: 15,
    };
    const result = runBenchmark(graph, candidates.stops, config);
    const scenario = result.summaries[0].scenarios[1];
    expect(deriveScenarioSeed(config.baseSeed, scenario.k, scenario.index)).toBe(
      scenario.seed,
    );
    const restored = generateScenario(
      candidates.stops,
      scenario.k,
      scenario.seed,
      config.passengersPerStop,
    );
    expect(restored.stops.map((s) => s.stop.id)).toEqual(scenario.stopIds);

    const rerun = solveRoute(graph, restored.stops, { mode: 'compare', hkLimit: 15 });
    expect(rerun.comparison).not.toBeNull();
    expect(rerun.comparison!.greedy.totalDistance).toBeCloseTo(
      scenario.greedyDistance,
      6,
    );
    expect(rerun.comparison!.optimal.totalDistance).toBeCloseTo(
      scenario.optimalDistance,
      6,
    );
  });

  it('summarises p90 and the greedy optimal rate', () => {
    const result = runBenchmark(graph, candidates.stops, {
      kValues: [4],
      scenariosPerK: 5,
      baseSeed: 7,
      passengersPerStop: 1,
      hkLimit: 15,
    });
    const summary = summarize(4, result.summaries[0].scenarios);
    expect(summary.count).toBe(5);
    expect(summary.p90Gap).toBeGreaterThanOrEqual(summary.medianGap);
    expect(summary.maxGap).toBeGreaterThanOrEqual(summary.p90Gap);
    expect(summary.greedyOptimalRate).toBeGreaterThanOrEqual(0);
    expect(summary.greedyOptimalRate).toBeLessThanOrEqual(100);
  });

  it('runs a single scenario through the public helper', () => {
    const config = {
      kValues: [5],
      scenariosPerK: 1,
      baseSeed: 11,
      passengersPerStop: 1,
      hkLimit: 15,
    };
    const { cache, cacheMs } = buildDistanceCache(graph, candidates.stops);
    expect(cacheMs).toBeGreaterThanOrEqual(0);
    const scenario = runScenario(graph, cache, candidates.stops, 5, 0, config);
    expect(scenario.skipped).toBe(false);
    expect(scenario.bug).toBe(false);
    expect(scenario.optimalDistance).toBeLessThanOrEqual(scenario.greedyDistance + 1e-6);
  });
});

describe('preset scenarios', () => {
  const presets = (presetsData as { presets: Array<Record<string, unknown>> }).presets;

  it('load and match their recorded gaps on a fresh run', () => {
    expect(presets.length).toBeGreaterThanOrEqual(5);
    for (const preset of presets) {
      const ids = preset.stopIds as string[];
      const stops = ids.map((id) => {
        const stop = graph.stops.find((item) => item.id === id);
        if (!stop) throw new Error(`Preset stop ${id} missing`);
        return { stop, passengers: Number(preset.passengers ?? 1) };
      });
      const result = solveRoute(graph, stops, { mode: 'compare', hkLimit: 15 });
      expect(result.comparison).not.toBeNull();
      expect(result.comparison!.greedy.totalDistance).toBeCloseTo(
        Number(preset.greedyDistance),
        1,
      );
      expect(result.comparison!.optimal.totalDistance).toBeCloseTo(
        Number(preset.optimalDistance),
        1,
      );
      expect(result.comparison!.gap).toBeCloseTo(Number(preset.gapMeters), 1);
      expect(result.comparison!.gap).toBeGreaterThanOrEqual(-1e-6);
      expect((preset.stopIds as string[]).length).toBe(Number(preset.k));
    }
  });
});
