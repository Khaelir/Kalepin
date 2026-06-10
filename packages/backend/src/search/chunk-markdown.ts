export interface Chunk {
  text: string;
  heading: string;
  chunkIdx: number;
}

/** Humanize a file path for embedding context: strip .md, replace separators with spaces. */
export function humanizePath(filePath: string): string {
  return filePath
    .replace(/\.md$/, '')
    .replace(/[/_-]/g, ' ')
    .trim();
}

const MAX_CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 200;

/**
 * Splits markdown content into chunks at heading boundaries.
 * Long sections are sub-split on paragraph boundaries with overlap.
 */
const MIN_CHUNK_CHARS = 50;

export function chunkMarkdown(content: string, path: string): Chunk[] {
  if (!content || !content.trim()) return [];

  const rawSections = splitByHeadings(content);
  // Merge tiny sections (heading-only or near-empty) into the next section
  const sections = mergeTinySections(rawSections);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const subChunks = softSplit(section.text, section.heading);
    for (const sc of subChunks) {
      chunks.push({ text: sc, heading: section.heading, chunkIdx: chunks.length });
    }
  }

  return chunks;
}

interface Section {
  heading: string;
  text: string;
}

function splitByHeadings(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Flush previous section
      if (currentLines.length > 0) {
        const text = currentLines.join('\n').trim();
        if (text) sections.push({ heading: currentHeading, text });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  // Flush last section
  if (currentLines.length > 0) {
    const text = currentLines.join('\n').trim();
    if (text) sections.push({ heading: currentHeading, text });
  }

  return sections;
}

function mergeTinySections(sections: Section[]): Section[] {
  const merged: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section.text.length < MIN_CHUNK_CHARS && i + 1 < sections.length) {
      // Prepend this tiny section's text to the next section
      const next = sections[i + 1];
      next.text = section.text + '\n\n' + next.text;
      if (!next.heading) next.heading = section.heading;
    } else {
      merged.push(section);
    }
  }
  return merged;
}

function softSplit(text: string, heading: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  let insideFence = false;

  for (const para of paragraphs) {
    // Track fenced code block boundaries
    const fenceMatches = para.match(/^```/gm);
    if (fenceMatches) {
      for (const _ of fenceMatches) {
        insideFence = !insideFence;
      }
    }

    // Never split inside a fenced code block — let the chunk grow
    if (insideFence || (current && (current.length + para.length + 2) <= MAX_CHUNK_CHARS)) {
      current = current ? `${current}\n\n${para}` : para;
    } else if (current && (current.length + para.length + 2) > MAX_CHUNK_CHARS) {
      chunks.push(current.trim());
      // Start next chunk with overlap from end of current
      const overlap = current.slice(-OVERLAP_CHARS);
      current = heading ? `# ${heading}\n\n${overlap}\n\n${para}` : `${overlap}\n\n${para}`;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
