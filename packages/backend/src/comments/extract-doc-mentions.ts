/**
 * Extract mentions from markdown document content.
 * Returns a Set of {email, line} objects from @[pseudo](email) patterns.
 */
export function extractDocMentions(markdownContent: string): Set<string> {
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const emails = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdownContent)) !== null) {
    emails.add(match[2]);
  }
  return emails;
}

export interface DocMention {
  email: string;
  line: number;
}

/**
 * Extract mentions with line numbers for heading resolution.
 */
export function extractDocMentionsWithLines(markdownContent: string): DocMention[] {
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const mentions: DocMention[] = [];
  const lines = markdownContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lines[i])) !== null) {
      mentions.push({ email: match[2], line: i });
    }
  }
  return mentions;
}
