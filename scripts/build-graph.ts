import fs from 'node:fs';
import path from 'node:path';
import { buildGraph, type RawGeoJSON } from '../src/lib/buildGraph';
import {
  DESTINATION_NODE_ID,
  MAX_STOP_SNAP_METERS,
  START_NODE_ID,
} from '../src/config';

const root = process.cwd();
const inputPath = path.resolve(root, process.argv[2] ?? 'export.geojson');
const outputPath = path.resolve(root, 'public/graph.json');

if (!fs.existsSync(inputPath)) {
  console.error(`✗ Source file not found: ${inputPath}`);
  process.exit(1);
}

console.log(`→ Reading ${path.relative(root, inputPath)}`);
const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as RawGeoJSON;

const started = performance.now();
const graph = buildGraph(raw, {
  startNodeId: START_NODE_ID,
  destinationNodeId: DESTINATION_NODE_ID,
  maxStopSnapMeters: MAX_STOP_SNAP_METERS,
  sourceName: path.basename(inputPath),
});
const elapsed = Math.round(performance.now() - started);

const json = JSON.stringify(graph);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, json);

const m = graph.meta;
console.log('');
console.log('  Bus-way graph build');
console.log('  ─────────────────────────────────────────────');
console.log(`  source features         ${m.featureCount}`);
console.log(`  vertices (raw → main)   ${m.rawVertexCount} → ${m.vertexCount}`);
console.log(`  directed edges (raw → kept) ${m.rawEdgeCount} → ${m.edgeCount} (${m.droppedEdgeCount} outside main component)`);
console.log(`  drivable ways           ${m.drivableWayCount} (${m.omittedWays} non-drivable omitted)`);
console.log(`  weak components         ${m.componentSizes.join(', ')}`);
console.log(`  main component          ${m.mainComponentSize} vertices (${m.componentSizes.length} components)`);
console.log(`  largest strong component ${m.largestStrongComponentSize} vertices`);
console.log(`  one-way segments        ${m.oneWaySegmentCount}`);
console.log(`  selectable stops        ${m.stopCount} (${m.droppedFarStops} dropped as too far from a road)`);
console.log(`  start snap              ${graph.start.name} → ${m.startSnapMeters.toFixed(1)} m`);
console.log(`  destination snap        ${graph.destination.name} → ${m.destinationSnapMeters.toFixed(1)} m`);
console.log(`  worst kept stop snap    ${m.maxStopSnapMeters.toFixed(1)} m`);
console.log('  ─────────────────────────────────────────────');
console.log(`  wrote ${path.relative(root, outputPath)} (${(json.length / 1024).toFixed(0)} KB) in ${elapsed} ms`);
console.log('');
