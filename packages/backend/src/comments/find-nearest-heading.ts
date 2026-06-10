/**
 * Find the nearest heading above a given line number in markdown content.
 * Returns a slugified heading string suitable for URL anchors, or undefined if none found.
 */
export function findNearestHeading(markdownContent: string, mentionLine: number): string | undefined {
  const lines = markdownContent.split('\n');
  let lastHeading: string | undefined;

  for (let i = 0; i < lines.length && i < mentionLine; i++) {
    const match = lines[i].match(/^#{1,6}\s+(.+)$/);
    if (match) {
      lastHeading = slugify(match[1].trim());
    }
  }

  return lastHeading;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
