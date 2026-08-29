import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLineWords } from '../scripts/update-menu-cache.mjs';

const IMAGE_WIDTH = 805;

function word(text, left, width, options = {}) {
  return {
    text,
    left,
    top: options.top ?? 200,
    width,
    height: options.height ?? 30,
    conf: options.conf ?? 96
  };
}

function filteredLine(words) {
  return filterLineWords(words, IMAGE_WIDTH).map(item => item.text).join(' ');
}

test('Wednesday keeps the menu content and drops an isolated low-confidence logo reading', () => {
  const lines = [
    [word('Émincé', 14, 135), word('de', 165, 44), word('bœuf', 224, 100), word('Label', 335, 99), word('Rouge', 450, 121)],
    [word('Strogonoff', 13, 196), word('(champignons,', 219, 178), word('oignons,', 412, 99), word('ail,', 525, 32), word('tomate,', 569, 87)],
    [word('Brocolis', 14, 148), word('bio', 176, 53), word('persillés', 243, 153)],
    [word(':', 269, 4, { conf: 42, height: 4 }), word('reset', 697, 35, { conf: 0, height: 20 })]
  ].map(filteredLine).filter(Boolean);

  assert.deepEqual(lines, [
    'Émincé de bœuf Label Rouge',
    'Strogonoff (champignons, oignons, ail, tomate,',
    'Brocolis bio persillés'
  ]);
});

test('Friday keeps Couscous végétarien without an isolated low-confidence logo suffix', () => {
  const line = filteredLine([
    word('Couscous', 30, 184),
    word('végétarien', 229, 194),
    word('Honer', 669, 63, { conf: 0, height: 26 })
  ]);

  assert.equal(line, 'Couscous végétarien');
});

test('standalone low-confidence illustration readings are removed without a word blacklist', () => {
  const lines = [
    [word('Pastèque', 30, 184), word('bio', 230, 60), word('ce)', 549, 132, { conf: 17, height: 57 })],
    [word('"', 571, 5, { conf: 4, height: 7 }), word('ST', 585, 81, { conf: 42, height: 35 })]
  ].map(filteredLine).filter(Boolean);

  assert.deepEqual(lines, ['Pastèque bio']);
});

test('very-low-confidence punctuation fragments touching menu text are removed in the periphery', () => {
  const line = filteredLine([
    word('Fromage', 14, 160),
    word('Saint', 187, 90),
    word('Môret', 290, 105),
    word('bio', 419, 52),
    word('(Y', 512, 64, { conf: 0, height: 52 }),
    word('(P)', 625, 61, { conf: 0, height: 61 })
  ]);

  assert.equal(line, 'Fromage Saint Môret bio');
});

test('representative historical right-edge menu text remains unchanged', () => {
  const historicalLines = [
    [word('Tomate', 14, 105), word('bio', 132, 53), word("d'Île-de-France", 198, 212), word('Vinaigrette', 423, 170)],
    [word('sauce', 14, 95), word('Worcestershire', 122, 230), word('et', 365, 33), word('oignons', 411, 115)],
    [word('Purée', 30, 110), word('de', 153, 45), word('pomme', 214, 134), word('et', 365, 33), word('poire', 412, 92), word('bio', 519, 53)],
    [word('Biscuits', 250, 130), word('fourrés', 393, 115), word('fraise', 522, 103)],
    [word('pois', 512, 47), word('chiche', 570, 80, { conf: 20 })]
  ];

  assert.deepEqual(historicalLines.map(filteredLine), [
    "Tomate bio d'Île-de-France Vinaigrette",
    'sauce Worcestershire et oignons',
    'Purée de pomme et poire bio',
    'Biscuits fourrés fraise',
    'pois chiche'
  ]);
});
