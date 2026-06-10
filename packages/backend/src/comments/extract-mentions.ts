/**
 * Extract mentioned emails from comment text.
 * Parses the @[Display Name](email) pattern and returns unique emails.
 */
export function extractMentions(text: string): string[] {
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const emails = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    emails.add(match[2]);
  }
  return Array.from(emails);
}
