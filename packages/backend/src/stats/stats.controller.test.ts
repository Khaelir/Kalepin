import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SCOPE_PERMISSIONS } from '../auth/permissions';
import type { Permission } from '../auth/permissions';

describe('Stats endpoint scope enforcement', () => {
  const statsPermission: Permission = 'admin:stats';

  it('admin scope includes admin:stats', () => {
    assert.ok(SCOPE_PERMISSIONS['admin'].includes(statsPermission));
  });

  it('rw scope excludes admin:stats', () => {
    assert.ok(!SCOPE_PERMISSIONS['rw'].includes(statsPermission));
  });

  it('ro scope excludes admin:stats', () => {
    assert.ok(!SCOPE_PERMISSIONS['ro'].includes(statsPermission));
  });

  it('rc scope excludes admin:stats', () => {
    assert.ok(!SCOPE_PERMISSIONS['rc'].includes(statsPermission));
  });
});
