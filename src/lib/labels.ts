/** S = start, A..I = stops, T = terminal / destination. */
export function pointLabel(index: number, total: number): string {
  if (index === 0) return 'S';
  if (index === total - 1) return 'T';
  return String.fromCharCode(65 + index - 1);
}

export function pointLabels(total: number): string[] {
  return Array.from({ length: total }, (_, i) => pointLabel(i, total));
}
