export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
export const DAY_INDEX = Object.fromEntries(DAYS.map((day, index) => [day, index]));

export function parseIsoDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

export function getDayDate(menu, day) {
  return addDays(menu.monday, DAY_INDEX[day] || 0);
}

export function getMenuEntries(menus) {
  return menus
    .flatMap(menu => DAYS.map(day => ({
      menu,
      day,
      date: getDayDate(menu, day)
    })))
    .sort((a, b) => a.date - b.date);
}

export function getEntryId(entry) {
  return `${entry.menu.mondayDate}-${entry.day}`;
}

export function buildMenuSections(menus, highlights, today = new Date()) {
  const todayStart = startOfDay(today);
  const currentWeekMonday = getMonday(todayStart);
  const highlightedIds = new Set(highlights.map(getEntryId));
  const entries = getMenuEntries(menus);
  const visibleEntries = entries.filter(entry => !highlightedIds.has(getEntryId(entry)));

  const currentWeek = groupWeekEntries(
    visibleEntries.filter(entry => sameDay(entry.menu.monday, currentWeekMonday) && entry.date >= todayStart)
  )[0] || null;

  const futureWeeks = groupWeekEntries(
    visibleEntries.filter(entry => entry.menu.monday > currentWeekMonday && entry.date >= todayStart)
  ).sort(sortWeeksAscending);

  const archivedWeeks = groupWeekEntries(
    entries.filter(entry => entry.date < todayStart)
  ).sort(sortWeeksDescending);

  return { currentWeek, futureWeeks, archivedWeeks };
}

function getMonday(date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function sameDay(first, second) {
  return first.getTime() === second.getTime();
}

function groupWeekEntries(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const key = entry.menu.mondayDate;
    const group = groups.get(key) || { menu: entry.menu, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function sortWeeksAscending(first, second) {
  return first.menu.monday - second.menu.monday;
}

function sortWeeksDescending(first, second) {
  return second.menu.monday - first.menu.monday;
}
