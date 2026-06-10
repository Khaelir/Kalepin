export const COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // amber
  '#9b59b6', // purple
  '#e91e63', // pink
  '#00bcd4', // cyan
  '#ff5722', // deep orange
  '#607d8b', // blue-grey
  '#8bc34a', // lime
];

export function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
