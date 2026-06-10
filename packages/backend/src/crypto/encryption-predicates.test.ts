import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { EncryptionZone } from '../entities/encryption-zone.entity';
import { EncryptionZonesService } from '../encryption/encryption-zones.service';
import { DefaultEncryptionPredicates } from './encryption-predicates';

let ds: DataSource;
let zones: EncryptionZonesService;
let predicates: DefaultEncryptionPredicates;

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [EncryptionZone],
    synchronize: true,
  });
  await ds.initialize();
  zones = new EncryptionZonesService(ds.getRepository(EncryptionZone));
  await zones.initForTests();
  predicates = new DefaultEncryptionPredicates(zones);
});

afterEach(async () => {
  await ds.destroy();
});

describe('DefaultEncryptionPredicates — stage 1 defaults', () => {
  it('isEncryptedAtRest is true under _users/* by default', () => {
    assert.equal(predicates.isEncryptedAtRest('_users/alice/foo.md'), true);
    assert.equal(predicates.isEncryptedAtRest('_users/alice/_attachments/x.png'), true);
  });

  it('isEncryptedAtRest is false under shared by default', () => {
    assert.equal(predicates.isEncryptedAtRest('Notes/foo.md'), false);
    assert.equal(predicates.isEncryptedAtRest(''), false);
  });

  it('flipping shared.enabled flips isEncryptedAtRest for shared paths', async () => {
    assert.equal(predicates.isEncryptedAtRest('Notes/foo.md'), false);
    await zones.set('shared', { enabled: true });
    assert.equal(predicates.isEncryptedAtRest('Notes/foo.md'), true);
  });

  it('flipping personal.enabled flips isEncryptedAtRest for personal paths', async () => {
    assert.equal(predicates.isEncryptedAtRest('_users/alice/foo.md'), true);
    await zones.set('personal', { enabled: false });
    assert.equal(predicates.isEncryptedAtRest('_users/alice/foo.md'), false);
  });

  it('isE2EEncrypted matches _users/{x}/_secure[/...] only', () => {
    // Personal user roots — under _secure/
    assert.equal(predicates.isE2EEncrypted('_users/alice/_secure/foo.md'), true);
    assert.equal(predicates.isE2EEncrypted('_users/alice/_secure/sub/bar.md'), true);
    // The bare folder itself
    assert.equal(predicates.isE2EEncrypted('_users/alice/_secure'), true);
    // Personal user roots — outside _secure/
    assert.equal(predicates.isE2EEncrypted('_users/alice/foo.md'), false);
    // Nested _secure deeper than user root
    assert.equal(predicates.isE2EEncrypted('_users/alice/foo/_secure/bar.md'), false);
    // Shared zone never E2E
    assert.equal(predicates.isE2EEncrypted('Notes/foo.md'), false);
    assert.equal(predicates.isE2EEncrypted('vault/_secure/foo.md'), false);
    // Bare _secure not under _users
    assert.equal(predicates.isE2EEncrypted('_secure/foo.md'), false);
  });

  it('shouldIndexPlaintext, canCollab, shareLinkMintable cascade on _secure/ paths', () => {
    const e2e = '_users/alice/_secure/diary.md';
    assert.equal(predicates.shouldIndexPlaintext(e2e), false);
    assert.equal(predicates.canCollab(e2e), false);
    assert.equal(predicates.shareLinkMintable(e2e), false);
    assert.equal(predicates.commentBodiesEncrypted(e2e), true);
    // Personal but not _secure: stays permissive
    for (const p of ['_users/alice/foo.md', 'Notes/team.md']) {
      assert.equal(predicates.shouldIndexPlaintext(p), true, `shouldIndexPlaintext ${p}`);
      assert.equal(predicates.canCollab(p), true, `canCollab ${p}`);
      assert.equal(predicates.shareLinkMintable(p), true, `shareLinkMintable ${p}`);
      assert.equal(predicates.commentBodiesEncrypted(p), false, `commentBodiesEncrypted ${p}`);
    }
  });

  it('isEncryptedAtRest is true for _secure/ paths regardless of zone state', async () => {
    const e2e = '_users/alice/_secure/diary.md';
    assert.equal(predicates.isEncryptedAtRest(e2e), true);
    await zones.set('personal', { enabled: false });
    assert.equal(predicates.isEncryptedAtRest(e2e), true);
  });
});

describe('DefaultEncryptionPredicates — stage 2 contract', () => {
  /**
   * Verifies that overriding only `isE2EEncrypted` cascades correctly to the
   * other four predicates. This is the load-bearing seam the stage-2 change
   * relies on.
   */
  class StageTwoStub extends DefaultEncryptionPredicates {
    constructor(zones: EncryptionZonesService, private readonly secretPaths: Set<string>) {
      super(zones);
    }
    override isE2EEncrypted(path: string): boolean {
      return this.secretPaths.has(path);
    }
  }

  it('flipping isE2EEncrypted cascades to shouldIndexPlaintext / canCollab / commentBodiesEncrypted / shareLinkMintable', () => {
    const secret = '_users/alice/_secure/diary.md';
    const stub = new StageTwoStub(zones, new Set([secret]));
    assert.equal(stub.isE2EEncrypted(secret), true);
    assert.equal(stub.shouldIndexPlaintext(secret), false);
    assert.equal(stub.canCollab(secret), false);
    assert.equal(stub.shareLinkMintable(secret), false);
    assert.equal(stub.commentBodiesEncrypted(secret), true);
    // And isEncryptedAtRest must follow regardless of zone enabled state
    assert.equal(stub.isEncryptedAtRest(secret), true);

    // Non-secret personal path still follows zone state
    const personal = '_users/alice/foo.md';
    assert.equal(stub.isE2EEncrypted(personal), false);
    assert.equal(stub.shouldIndexPlaintext(personal), true);
    assert.equal(stub.canCollab(personal), true);
  });
});
