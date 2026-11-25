import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { StarredItem } from '../entities/starred-item.entity';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { StarsService } from './stars.service';

const EMAIL = 'bob@example.com';

let ds: DataSource;
let repo: Repository<StarredItem>;
let grants: GrantsService;
let service: StarsService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [StarredItem, DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(StarredItem);
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  service = new StarsService(repo, new GrantAwareVisibility(grants));
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('StarsService.autoStarForUser', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates a star on first mention', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md', EMAIL);
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 1);
    assert.equal(stars[0].path, 'notes/meeting.md');
    assert.equal(stars[0].type, 'file');
  });

  it('is idempotent — no error on duplicate', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md', EMAIL);
    await service.autoStarForUser(1, 'notes/meeting.md', EMAIL);
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 1);
  });

  it('allows different users to star the same doc', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md', EMAIL);
    await service.autoStarForUser(2, 'notes/meeting.md', EMAIL);
    const stars1 = await service.listByUser(1);
    const stars2 = await service.listByUser(2);
    assert.equal(stars1.length, 1);
    assert.equal(stars2.length, 1);
  });

  it('allows user to star multiple docs', async () => {
    await service.autoStarForUser(1, 'notes/a.md', EMAIL);
    await service.autoStarForUser(1, 'notes/b.md', EMAIL);
    await service.autoStarForUser(1, 'notes/c.md', EMAIL);
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 3);
  });
});

describe('StarsService — personal paths the user cannot see', () => {
  beforeEach(setup);
  afterEach(teardown);

  const ALICE_NOTE = '_users/alice@example.com/Layoff plan.md';

  it('a mention in someone else\'s personal note does not star it', async () => {
    await service.autoStarForUser(2, ALICE_NOTE, EMAIL);
    assert.equal(await repo.count(), 0);
  });

  it('a mention in a note the user sees through a grant, or in their own folder, does', async () => {
    await grants.mint({ grantorEmail: 'alice@example.com', granteeEmail: EMAIL, path: ALICE_NOTE, permission: 'read' });
    await service.autoStarForUser(2, ALICE_NOTE, 'Bob@Example.com');
    await service.autoStarForUser(2, '_users/bob@example.com/mine.md', EMAIL);
    assert.deepEqual((await service.listByUser(2, EMAIL)).map((s) => s.path).sort(), [ALICE_NOTE, '_users/bob@example.com/mine.md']);
  });

  it('GET /api/stars leaves out stars the user can no longer see', async () => {
    // Stars made before this fix, or on a note that later moved into Alice's
    // folder or whose grant ended.
    await service.addStar(2, 'file', ALICE_NOTE);
    await service.addStar(2, 'file', 'notes/shared.md');
    assert.deepEqual((await service.listByUser(2, EMAIL)).map((s) => s.path), ['notes/shared.md']);
  });
});
