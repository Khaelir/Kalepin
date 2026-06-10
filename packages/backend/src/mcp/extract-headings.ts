/**
 * Extract markdown headings from raw content.
 * Skips lines inside fenced code blocks.
 * Returns heading lines with original `#` prefixes.
 */
export function extractHeadings(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headings: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push(line);
    }
  }
  return headings;
}
