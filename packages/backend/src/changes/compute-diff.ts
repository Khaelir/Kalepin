import { createTwoFilesPatch } from 'diff';

export function computeUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent);
}
