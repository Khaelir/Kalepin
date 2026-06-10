import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { EncryptionZone } from '../entities/encryption-zone.entity';
import { EncryptionZonesService } from './encryption-zones.service';

let ds: DataSource;
let repo: Repository<EncryptionZone>;
let svc: EncryptionZonesService;

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [EncryptionZone],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(EncryptionZone);
  svc = new EncryptionZonesService(repo);
  await svc.initForTests();
});

afterEach(async () => {
  await ds.destroy();
});

describe('EncryptionZonesService', () => {
  it('seeds personal=enabled, shared=disabled by default', () => {
    assert.equal(svc.get('personal').enabled, true);
    assert.equal(svc.get('shared').enabled, false);
  });

  it('isEnabled is sync and reflects defaults', () => {
    assert.equal(svc.isEnabled('personal'), true);
    assert.equal(svc.isEnabled('shared'), false);
  });

  it('set() persists and updates the cache', async () => {
    await svc.set('shared', { enabled: true });
    assert.equal(svc.isEnabled('shared'), true);
    const row = await repo.findOneByOrFail({ zone: 'shared' });
    assert.equal(row.enabled, 1);
  });

  it('set() persists migration progress without flipping enabled', async () => {
    await svc.set('personal', { migrationState: 'decrypting', migrationTotal: 1000, migrationProgress: 0 });
    const s1 = svc.get('personal');
    assert.equal(s1.migrationState, 'decrypting');
    assert.equal(s1.migrationTotal, 1000);
    assert.equal(s1.enabled, true);

    await svc.set('personal', { migrationProgress: 432 });
    assert.equal(svc.get('personal').migrationProgress, 432);
  });

  it('set() updates kekFingerprint blob', async () => {
    const fp = Buffer.from('0123456789abcdef', 'hex');
    await svc.set('personal', { kekFingerprint: fp });
    assert.deepEqual(svc.get('personal').kekFingerprint, fp);
  });

  it('does not re-seed if rows already exist', async () => {
    // Modify a row directly in DB, then re-init
    await repo.update({ zone: 'shared' }, { enabled: 1, updatedAt: Date.now() });
    const svc2 = new EncryptionZonesService(repo);
    await svc2.initForTests();
    assert.equal(svc2.isEnabled('shared'), true);
  });
});
