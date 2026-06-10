import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LinkIndexService } from './link-index.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

interface FakeLinkRow {
  sourcePath: string;
  targetPath: string | null;
  rawTarget: string;
  lineNumber: number;
  context: string | null;
  linkType: 'wikilink' | 'markdown';
}

function makeLinkIndexService(rows: FakeLinkRow[], allPaths: string[] = []) {
  const linkRepo = {
    async find({ where }: any = {}) {
      if (!where) return rows;
      if ('targetPath' in where) return rows.filter((r) => r.targetPath === where.targetPath);
      if ('sourcePath' in where) return rows.filter((r) => r.sourcePath === where.sourcePath);
      return rows;
    },
    async delete() {},
  };
  const dataSource = {
    async query() {
      // Used only for FTS / note_changes — return empty for graph tests.
      return [];
    },
  };
  const storage = { async list() { return []; } } as any;
  const fileWatcher = { register: () => {}, on: () => {} } as any;
  const svc = new LinkIndexService(
    linkRepo as any,
    storage,
    dataSource as any,
    fileWatcher,
  );
  // Inject the in-memory `allPaths` set the service uses for the no-centerPath branch.
  (svc as any).allPaths = new Set(allPaths);
  return svc;
}

describe('LinkIndexService — getBacklinks', () => {
  it('drops links whose source is not visible to the viewer', async () => {
    const rows: FakeLinkRow[] = [
      {
        sourcePath: 'Notes/shared.md',
        targetPath: 'Notes/target.md',
        rawTarget: 'target',
        lineNumber: 1,
        context: 'shared',
        linkType: 'wikilink',
      },
      {
        sourcePath: '_users/alice@example.com/diary.md',
        targetPath: 'Notes/target.md',
        rawTarget: 'target',
        lineNumber: 2,
        context: 'private',
        linkType: 'wikilink',
      },
    ];
    const svc = makeLinkIndexService(rows);

    const aliceBacklinks = await svc.getBacklinks('Notes/target.md', ALICE);
    assert.equal(aliceBacklinks.length, 2, 'Alice sees both shared and her own personal source');

    const bobBacklinks = await svc.getBacklinks('Notes/target.md', BOB);
    assert.deepEqual(
      bobBacklinks.map((b) => b.sourcePath).sort(),
      ['Notes/shared.md'],
      'Bob sees shared source only — Alice\'s personal source is dropped',
    );

    const noEmail = await svc.getBacklinks('Notes/target.md');
    assert.equal(noEmail.length, 2, 'system caller (no userEmail) sees everything');
  });
});

describe('LinkIndexService — getOutgoingLinks', () => {
  it('drops links whose target is not visible to the viewer', async () => {
    const rows: FakeLinkRow[] = [
      {
        sourcePath: 'Notes/foo.md',
        targetPath: 'Notes/bar.md',
        rawTarget: 'bar',
        lineNumber: 1,
        context: null,
        linkType: 'wikilink',
      },
      {
        sourcePath: 'Notes/foo.md',
        targetPath: '_users/alice@example.com/diary.md',
        rawTarget: 'diary',
        lineNumber: 2,
        context: null,
        linkType: 'wikilink',
      },
      {
        sourcePath: 'Notes/foo.md',
        targetPath: null,
        rawTarget: 'broken-link',
        lineNumber: 3,
        context: null,
        linkType: 'wikilink',
      },
    ];
    const svc = makeLinkIndexService(rows);

    const aliceOut = await svc.getOutgoingLinks('Notes/foo.md', ALICE);
    const aliceTargets = aliceOut.map((o) => o.targetPath ?? `broken:${o.rawTarget}`).sort();
    assert.deepEqual(aliceTargets, ['Notes/bar.md', '_users/alice@example.com/diary.md', 'broken:broken-link']);

    const bobOut = await svc.getOutgoingLinks('Notes/foo.md', BOB);
    const bobTargets = bobOut.map((o) => o.targetPath ?? `broken:${o.rawTarget}`).sort();
    // Alice's diary target dropped; broken links preserved (no target to gate).
    assert.deepEqual(bobTargets, ['Notes/bar.md', 'broken:broken-link']);
  });
});

describe('LinkIndexService — getGraphData', () => {
  it('non-owner sees neither node nor edge for foreign personal data', async () => {
    const rows: FakeLinkRow[] = [
      {
        sourcePath: 'Notes/A.md',
        targetPath: '_users/alice@example.com/secret.md',
        rawTarget: 'secret',
        lineNumber: 1,
        context: null,
        linkType: 'wikilink',
      },
      {
        sourcePath: 'Notes/A.md',
        targetPath: 'Notes/B.md',
        rawTarget: 'B',
        lineNumber: 2,
        context: null,
        linkType: 'wikilink',
      },
    ];
    const allPaths = ['Notes/A.md', 'Notes/B.md', '_users/alice@example.com/secret.md'];
    const svc = makeLinkIndexService(rows, allPaths);

    const aliceGraph = await svc.getGraphData(undefined, 2, ALICE);
    const aliceNodes = aliceGraph.nodes.map((n) => n.path).sort();
    assert.ok(aliceNodes.includes('_users/alice@example.com/secret.md'), 'Alice sees her own secret node');
    assert.ok(aliceNodes.includes('Notes/A.md'));

    const bobGraph = await svc.getGraphData(undefined, 2, BOB);
    const bobNodes = bobGraph.nodes.map((n) => n.path);
    const bobEdges = bobGraph.edges.map((e) => `${e.source}->${e.target}`);
    assert.ok(!bobNodes.some((p) => p.includes('alice@example.com')), `Bob nodes: ${bobNodes.join(', ')}`);
    assert.ok(!bobEdges.some((e) => e.includes('alice@example.com')), `Bob edges: ${bobEdges.join(', ')}`);
    assert.ok(bobNodes.includes('Notes/A.md'));
    assert.ok(bobNodes.includes('Notes/B.md'));
  });
});
