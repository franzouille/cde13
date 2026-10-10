import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { loadManualMenus, mergeManualMenus } from '../scripts/update-menu-cache.mjs';

test('one-off menu includes five transcribed days and its local source image', async () => {
  const menus = await loadManualMenus();
  const menu = menus.find(menu => menu.mondayDate === '2026-10-12');
  assert.ok(menu);
  await access(menu.manualImagePath);
  for (const day of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) {
    assert.ok(menu.dayTexts[day].startsWith(`${day}\n`));
    assert.ok(menu.dayTexts[day].split('\n').length >= 5);
  }
});

test('manual transcription overrides only its week, stays sorted and ages out of latest five', () => {
  const historical = { mondayDate: '2026-10-05', dayTexts: { Lundi: 'unchanged' } };
  const manual = { mondayDate: '2026-10-12', dayTexts: { Lundi: 'transcribed' } };
  const merged = mergeManualMenus([historical, { mondayDate: '2026-10-12' }], [manual]);
  assert.deepEqual(merged, [historical, manual]);
  assert.equal(merged[0], historical);
  const future = ['19', '26'].map(day => ({ mondayDate: `2026-10-${day}` }));
  future.push(...['02', '09', '16'].map(day => ({ mondayDate: `2026-11-${day}` })));
  assert.deepEqual(mergeManualMenus([...merged, ...future], [manual]).slice(-5), future);
});
