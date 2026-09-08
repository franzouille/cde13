import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAYS,
  buildMenuSections,
  getMenuEntries,
  parseIsoDate
} from '../web/menu-ordering.js';

function makeWeek(mondayDate) {
  return { mondayDate, monday: parseIsoDate(mondayDate) };
}

function entryFor(menus, mondayDate, day) {
  return getMenuEntries(menus).find(entry => entry.menu.mondayDate === mondayDate && entry.day === day);
}

function dayNames(group) {
  return group.entries.map(entry => entry.day);
}

test('keeps the highlighted days out of the current and future card lists', () => {
  const menus = [makeWeek('2026-09-07'), makeWeek('2026-09-14')];
  const highlights = [
    entryFor(menus, '2026-09-07', 'Mardi'),
    entryFor(menus, '2026-09-07', 'Mercredi')
  ];

  const sections = buildMenuSections(menus, highlights, new Date(2026, 8, 8));

  assert.deepEqual(dayNames(sections.currentWeek), ['Jeudi', 'Vendredi']);
  assert.equal(sections.futureWeeks.length, 1);
  assert.deepEqual(dayNames(sections.futureWeeks[0]), DAYS);
  assert.equal(sections.archivedWeeks.length, 1);
  assert.deepEqual(dayNames(sections.archivedWeeks[0]), ['Lundi']);
});

test('keeps the remaining current-week cards after two calendar highlights', () => {
  const menus = [makeWeek('2026-09-07')];
  const highlights = [
    entryFor(menus, '2026-09-07', 'Lundi'),
    entryFor(menus, '2026-09-07', 'Mardi')
  ];

  const sections = buildMenuSections(menus, highlights, new Date(2026, 8, 7));

  assert.deepEqual(dayNames(sections.currentWeek), ['Mercredi', 'Jeudi', 'Vendredi']);
  assert.equal(sections.archivedWeeks.length, 0);
});

test('keeps a highlighted next Monday out of its titled future week', () => {
  const menus = [makeWeek('2026-09-07'), makeWeek('2026-09-14')];
  const highlights = [
    entryFor(menus, '2026-09-07', 'Vendredi'),
    entryFor(menus, '2026-09-14', 'Lundi')
  ];

  const sections = buildMenuSections(menus, highlights, new Date(2026, 8, 11));

  assert.equal(sections.currentWeek, null);
  assert.equal(sections.futureWeeks.length, 1);
  assert.deepEqual(dayNames(sections.futureWeeks[0]), ['Mardi', 'Mercredi', 'Jeudi', 'Vendredi']);
  assert.deepEqual(dayNames(sections.archivedWeeks[0]), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi']);
});

test('puts all past weeks after the archive divider, newest first', () => {
  const menus = [
    makeWeek('2026-08-24'),
    makeWeek('2026-08-31'),
    makeWeek('2026-09-07')
  ];

  const sections = buildMenuSections(menus, [], new Date(2026, 8, 8));

  assert.deepEqual(sections.futureWeeks.map(group => group.menu.mondayDate), []);
  assert.deepEqual(
    sections.archivedWeeks.map(group => group.menu.mondayDate),
    ['2026-09-07', '2026-08-31', '2026-08-24']
  );
  assert.deepEqual(dayNames(sections.archivedWeeks[0]), ['Lundi']);
});
