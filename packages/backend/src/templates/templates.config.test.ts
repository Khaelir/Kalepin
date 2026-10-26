import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeFolderSetting, readTemplatesConfig } from './templates.config';

describe('templates config', () => {
  it('defaults to Templates and Journal without personal folders', () => {
    assert.deepEqual(readTemplatesConfig({}), {
      templatesFolder: 'Templates',
      dailyNotesFolder: 'Journal',
      personalEnabled: false,
    });
  });

  it('reads the env and detects personal folders from PERSONAL_PATH', () => {
    assert.deepEqual(
      readTemplatesConfig({ TEMPLATES_FOLDER: '/Meta/Blueprints/', DAILY_NOTES_FOLDER: 'Daily', PERSONAL_PATH: '/data/personal' }),
      { templatesFolder: 'Meta/Blueprints', dailyNotesFolder: 'Daily', personalEnabled: true },
    );
  });

  it('falls back on folders that could escape or be hidden', () => {
    for (const bad of ['..', 'a/../b', '_users', '_users/x', '_secure', '.templates', 'a/.b', 'a//b', 'a\\b', '  ']) {
      assert.equal(normalizeFolderSetting(bad, 'Templates'), 'Templates', bad);
    }
  });
});
