import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LinkIndexService } from './link-index.service';

interface Row { sourcePath: string; targetPath: string | null }

function makeService(rows: Row[]) {
  const linkRepo = {
    async find({ where }: any) {
      if ('sourcePath' in where) return rows.filter((r) => r.sourcePath === where.sourcePath);
      return rows.filter((r) => r.targetPath === where.targetPath);
    },
  };
  return new LinkIndexService(linkRepo as any, {} as any, {} as any, {} as any);
}

describe('LinkIndexService — getLinkedPaths', () => {
  it('unions resolved outgoing targets and backlink sources', async () => {
    const svc = makeService([
      { sourcePath: 'a.md', targetPath: 'b.md' },
      { sourcePath: 'a.md', targetPath: null },
      { sourcePath: 'c.md', targetPath: 'a.md' },
      { sourcePath: 'c.md', targetPath: 'b.md' },
      { sourcePath: 'a.md', targetPath: 'b.md' },
    ]);
    assert.deepEqual([...(await svc.getLinkedPaths('a.md'))].sort(), ['b.md', 'c.md']);
    assert.deepEqual([...(await svc.getLinkedPaths('b.md'))].sort(), ['a.md', 'c.md']);
    assert.deepEqual([...(await svc.getLinkedPaths('z.md'))], []);
  });
});
