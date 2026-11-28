/** S = start, A..Z/AA.. = stops, T = terminal / destination. */
export function pointLabel(index: number, total: number): string {
  if (index === 0) return 'S';
  if (index === total - 1) return 'T';
  return stopLabel(index);
}

/** Excel-style base-26 labels: 1=A, 26=Z, 27=AA, 28=AB … */
export function stopLabel(index: number): string {
  let n = Math.max(1, Math.floor(index));
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function pointLabels(total: number): string[] {
  return Array.from({ length: total }, (_, i) => pointLabel(i, total));
}
