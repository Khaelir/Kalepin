import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { StarredItem } from '../entities/starred-item.entity';
import { StarsService } from './stars.service';

let ds: DataSource;
let repo: Repository<StarredItem>;
let service: StarsService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [StarredItem],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(StarredItem);
  service = new StarsService(repo);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('StarsService.autoStarForUser', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates a star on first mention', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md');
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 1);
    assert.equal(stars[0].path, 'notes/meeting.md');
    assert.equal(stars[0].type, 'file');
  });

  it('is idempotent — no error on duplicate', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md');
    await service.autoStarForUser(1, 'notes/meeting.md');
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 1);
  });

  it('allows different users to star the same doc', async () => {
    await service.autoStarForUser(1, 'notes/meeting.md');
    await service.autoStarForUser(2, 'notes/meeting.md');
    const stars1 = await service.listByUser(1);
    const stars2 = await service.listByUser(2);
    assert.equal(stars1.length, 1);
    assert.equal(stars2.length, 1);
  });

  it('allows user to star multiple docs', async () => {
    await service.autoStarForUser(1, 'notes/a.md');
    await service.autoStarForUser(1, 'notes/b.md');
    await service.autoStarForUser(1, 'notes/c.md');
    const stars = await service.listByUser(1);
    assert.equal(stars.length, 3);
  });
});
