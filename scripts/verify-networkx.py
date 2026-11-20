#!/usr/bin/env python3
"""
External verification of the app's Dijkstra output against networkx.

Usage:
    python3 scripts/export-reference-pairs.ts   # actually: npx tsx ...
    npx tsx scripts/export-reference-pairs.ts /tmp/busway-reference-pairs.json
    python3 scripts/verify-networkx.py /tmp/busway-reference-pairs.json

Requires networkx (pip install networkx). The app's unit tests use an
independent SPFA reference so this external check is optional but useful.
"""
import json
import math
import sys
from pathlib import Path

try:
    import networkx as nx
except ImportError:
    sys.exit("networkx is required: python3 -m pip install networkx")

root = Path(__file__).resolve().parent.parent
pairs_file = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/busway-reference-pairs.json")
if not pairs_file.exists():
    sys.exit(f"Missing {pairs_file}. Run: npx tsx scripts/export-reference-pairs.ts {pairs_file}")

raw = json.loads((root / "public" / "graph.json").read_text())
payload = json.loads(pairs_file.read_text())

G = nx.DiGraph()
G.add_nodes_from(range(len(raw["vertices"]) // 2))
for source, edges in enumerate(raw["adj"]):
    for target, weight in edges:
        existing = G.get_edge_data(source, target)
        if existing is None or weight < existing["weight"]:
            G.add_edge(source, target, weight=weight)

mismatches = 0
max_delta = 0.0
print(f"networkx {nx.__version__} · {G.number_of_nodes():,} nodes · {G.number_of_edges():,} edges")
print(f"{'#':>3}  {'source':>8}  {'target':>8}  {'app (m)':>12}  {'networkx (m)':>14}  {'Δ (m)':>10}")
for i, pair in enumerate(payload["pairs"], 1):
    source = pair["source"]
    target = pair["target"]
    ours = pair["distance"]
    if ours is None:
        ours = math.inf
    try:
        reference = nx.dijkstra_path_length(G, source, target, weight="weight")
    except nx.NetworkXNoPath:
        reference = math.inf
    if math.isinf(ours) or math.isinf(reference):
        delta = 0.0 if (math.isinf(ours) and math.isinf(reference)) else math.inf
    else:
        delta = abs(ours - reference)
    max_delta = max(max_delta, delta if math.isfinite(delta) else 999999)
    if delta > 1e-3:
        mismatches += 1
    print(
        f"{i:>3}  {source:>8}  {target:>8}  "
        f"{'∞' if math.isinf(ours) else f'{ours:12.3f}'}  "
        f"{'∞' if math.isinf(reference) else f'{reference:14.3f}'}  "
        f"{'∞' if math.isinf(delta) else f'{delta:10.6f}'}"
    )

print()
print(f"max |Δ| = {max_delta:.6f} m across {len(payload['pairs'])} pairs")
if mismatches:
    sys.exit(f"FAIL: {mismatches} mismatching pair(s)")
print("PASS: all Dijkstra distances match networkx.")
