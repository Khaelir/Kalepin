export function escapeLike(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/%/g, '\\%');
}
