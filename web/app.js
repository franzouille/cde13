const DATA_URL = new URL('menus.json', window.location.href).href;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const DAY_INDEX = Object.fromEntries(DAYS.map((day, index) => [day, index]));
const CLOSED_RE = /\b(ferme|fermé|fermeture|férié|ferie)\b/i;
const MENU_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EXTERNAL_ARROW_ICON = `
  <svg class="external-arrow-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" />
  </svg>
`;

const state = {
  payload: null,
  menus: [],
  highlights: [],
  lightbox: null,
  restoreFocusId: null,
  lastRefreshAt: 0
};

const app = document.querySelector('#app');
const headerSubtitle = document.querySelector('#header-subtitle');

window.addEventListener('pageshow', init);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastRefreshAt >= MENU_REFRESH_INTERVAL_MS) {
    init();
  }
});

async function init() {
  state.lastRefreshAt = Date.now();

  try {
    const payload = await fetchMenus();
    state.payload = payload;
    state.menus = normalizeMenus(payload.menus);

    if (!state.menus.length) {
      renderEmpty(payload);
      return;
    }

    state.highlights = getHighlightedDays(state.menus, new Date());
    renderApp();
  } catch (error) {
    renderError(error);
  }
}

async function fetchMenus() {
  const freshDataUrl = new URL(DATA_URL);
  freshDataUrl.searchParams.set('_', Date.now().toString());
  const response = await fetch(freshDataUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`menus.json a répondu HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeMenus(menus) {
  return (Array.isArray(menus) ? menus : [])
    .filter(menu => menu?.mondayDate)
    .sort((a, b) => b.mondayDate.localeCompare(a.mondayDate))
    .map(menu => ({
      ...menu,
      monday: parseIsoDate(menu.mondayDate),
      friday: addDays(parseIsoDate(menu.mondayDate), 4)
    }));
}

function getHighlightedDays(menus, today = new Date()) {
  const todayStart = startOfDay(today);
  const entries = getMenuEntries(menus);
  const future = entries
    .filter(entry => entry.date >= todayStart && hasUsableMenu(entry.menu, entry.day))
    .slice(0, 2);

  if (future.length) {
    return future.map(entry => ({
      ...entry,
      label: formatHighlightLabel(entry.date, todayStart)
    }));
  }

  return entries
    .filter(entry => hasUsableMenu(entry.menu, entry.day))
    .slice(-2)
    .map(entry => ({ ...entry, label: 'Dernier menu disponible' }));
}

function getMenuEntries(menus) {
  return menus
    .flatMap(menu => DAYS.map(day => ({
      menu,
      day,
      date: getDayDate(menu, day)
    })))
    .sort((a, b) => a.date - b.date);
}

function formatHighlightLabel(date, today) {
  const diff = daysBetween(today, date);
  const browserDay = today.getDay();

  if (diff === 0) {
    return 'Aujourd’hui';
  }

  if (diff === 1) {
    return 'Demain';
  }

  if (browserDay === 0 && diff === 2) {
    return 'Après-demain';
  }

  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(date);
}

function formatDateFr(date, options = {}) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: options.weekday,
    day: 'numeric',
    month: 'long',
    year: options.year
  }).format(date);
}

function cleanDayText(text, day) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line && !/^[>.,;:|\\/\-–—]+$/.test(line));

  const cleaned = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeText(line);
    const next = normalizeText(lines[index + 1] || '');

    if (normalized === normalizeText(day)) {
      continue;
    }

    if (isBannerNoiseLine(line)) {
      continue;
    }

    if (normalized === 'menu' && next === `${normalizeText(day)} vegetarien`) {
      cleaned.push('Menu végétarien');
      index += 1;
      continue;
    }

    if (normalized === 'vegetarien' || normalized === 'menu vegetarien') {
      cleaned.push('Menu végétarien');
      continue;
    }

    if (normalized === `${normalizeText(day)} vegetarien`) {
      cleaned.push('Menu végétarien');
      continue;
    }

    cleaned.push(line);
  }

  return joinContinuationLines(dedupeAdjacent(cleaned));
}

function isBannerNoiseLine(line) {
  const normalized = normalizeText(line);
  const compact = normalized.replace(/['\s]+/g, '');
  return ((normalized.includes('dernier jour') && normalized.includes('ecole')) || compact === 'dernierjourdecole') ||
    normalized === 'premier jour de' ||
    normalized.includes('centres de loisirs') ||
    /^vendredi\s+\d{1,2}$/.test(normalized);
}

function renderApp() {
  headerSubtitle.textContent = state.payload?.generatedAt
    ? `Mis à jour le ${formatDateFr(new Date(state.payload.generatedAt), { year: 'numeric' })}`
    : 'Mise à jour non datée';

  app.innerHTML = `
    <section class="detail" id="menu-detail">
      ${renderHighlightCards()}
      ${renderAllMenus()}
    </section>
    ${renderLightbox()}
  `;

  bindEvents();
  restoreFocus();
}

function renderAllMenus() {
  return `
    <section class="all-weeks" aria-label="Tous les menus disponibles">
      ${state.menus.map(menu => `
        <section class="week-section">
          <div class="week-head">
            <h2 class="week-title">${escapeHtml(formatWeekRange(menu))}</h2>
            ${renderWeekImageButton(menu)}
          </div>
          <div class="week-days">
            ${DAYS.map(day => renderDayMenu(menu, day)).join('')}
          </div>
        </section>
      `).join('')}
    </section>
  `;
}

function renderWeekImageButton(menu) {
  if (!menu.cachedImageUrl) {
    return '';
  }

  const weekRange = formatWeekRange(menu);
  return `
    <button
      class="week-image-link"
      type="button"
      data-lightbox-id="${escapeAttribute(`${menu.mondayDate}-week`)}"
      data-lightbox-url="${escapeAttribute(menu.cachedImageUrl)}"
      data-lightbox-alt="${escapeAttribute(`Image originale du menu de la semaine du ${weekRange}`)}"
      data-lightbox-title="${escapeAttribute(`Menu complet · ${weekRange}`)}"
      aria-label="Afficher le menu complet de la semaine du ${escapeAttribute(weekRange)}"
    >
      <span>menu complet</span>
      ${EXTERNAL_ARROW_ICON}
    </button>
  `;
}

function renderHighlightCards() {
  if (!state.highlights.length) {
    return '';
  }

  return `
    <section class="highlight-section" aria-label="Menus du jour et à venir">
      <div class="highlight-grid">
        ${state.highlights.map((highlight, index) => renderHighlightCard(highlight, index)).join('')}
      </div>
    </section>
  `;
}

function renderHighlightCard(highlight, index) {
  const allLines = cleanDayText(highlight.menu.dayTexts?.[highlight.day], highlight.day);
  const status = getDayStatus(allLines, isClosedDay(highlight.menu, highlight.day));
  const lines = allLines
    .filter(line => !isClosedLine(line) && !isMetaLine(line))
    .slice(0, 5);

  return `
    <article class="summary-card day-${escapeAttribute(normalizeText(highlight.day))}" aria-labelledby="summary-title-${index}">
      <div class="summary-head">
        <div>
          <p class="summary-label">${escapeHtml(highlight.label)}</p>
          <h2 id="summary-title-${index}">${escapeHtml(formatMenuTitle(highlight.day, highlight.date))}</h2>
          <p class="day-status ${status ? '' : 'is-empty'}">${status ? escapeHtml(status) : '&nbsp;'}</p>
        </div>
      </div>
      <ul class="summary-list">
        ${lines.length ? lines.map(line => `<li>${formatMenuLine(line)}</li>`).join('') : '<li>Menu non renseigné.</li>'}
      </ul>
    </article>
  `;
}

function renderDayMenu(menu, day) {
  const date = getDayDate(menu, day);
  const lines = cleanDayText(menu.dayTexts?.[day], day);
  const closed = isClosedDay(menu, day);
  const status = getDayStatus(lines, closed);
  const contentLines = closed ? [] : lines.filter(line => !isClosedLine(line) && !isMetaLine(line));

  return `
    <article class="menu-card">
      <header class="menu-head">
        <div class="menu-head-row">
          <div>
            <h3 class="muted">
              <span class="weekday">${escapeHtml(day)}</span>
              <span class="day-date">${escapeHtml(formatDayCardDateShort(date))}</span>
            </h3>
            <p class="day-status ${status ? '' : 'is-empty'}">${status ? escapeHtml(status) : '&nbsp;'}</p>
          </div>
          ${menu.dayImageUrls?.[day] ? `
            <button
              class="image-open-link"
              type="button"
              data-lightbox-id="${escapeAttribute(`${menu.mondayDate}-${day}`)}"
              data-lightbox-url="${escapeAttribute(menu.dayImageUrls[day])}"
              data-lightbox-alt="${escapeAttribute(`Image originale du menu du ${day}`)}"
              data-lightbox-title="${escapeAttribute(`${day} · ${formatDayCardDate(date)}`)}"
              aria-label="Afficher l’image du ${day}"
            >${EXTERNAL_ARROW_ICON}</button>
          ` : ''}
        </div>
      </header>

      ${closed && !contentLines.length
        ? ''
        : renderMenuLines(contentLines)}
    </article>
  `;
}

function getDayStatus(lines, closed) {
  if (closed) {
    return lines.find(isClosedLine) || 'Fermé';
  }
  return lines.find(isMetaLine) || '';
}

function renderMenuLines(lines) {
  return `
    <ul class="menu-list">
      ${lines.map(line => `<li>${formatMenuLine(line)}</li>`).join('')}
    </ul>
  `;
}

function renderLightbox() {
  if (!state.lightbox) {
    return '';
  }

  return `
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="${escapeAttribute(state.lightbox.title)}" data-action="close-lightbox">
      <div class="lightbox-panel">
        <header class="lightbox-head">
          <p>${escapeHtml(state.lightbox.title)}</p>
          <button class="lightbox-close" type="button" data-action="close-lightbox" aria-label="Fermer">Fermer</button>
        </header>
        <img src="${escapeAttribute(state.lightbox.url)}" alt="${escapeAttribute(state.lightbox.alt)}" loading="eager" decoding="async">
      </div>
    </div>
  `;
}

function bindEvents() {
  app.querySelectorAll('[data-lightbox-url]').forEach(button => {
    button.addEventListener('click', () => {
      state.lightbox = {
        id: button.dataset.lightboxId,
        url: button.dataset.lightboxUrl,
        alt: button.dataset.lightboxAlt,
        title: button.dataset.lightboxTitle
      };
      renderApp();
    });
  });

  app.querySelectorAll('[data-action="close-lightbox"]').forEach(element => {
    element.addEventListener('click', event => {
      if (event.target === element || element.classList.contains('lightbox-close')) {
        closeLightbox();
      }
    });
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.lightbox) {
    closeLightbox();
  }
});

function closeLightbox() {
  state.restoreFocusId = state.lightbox?.id || null;
  state.lightbox = null;
  renderApp();
}

function restoreFocus() {
  if (state.lightbox) {
    app.querySelector('.lightbox-close')?.focus();
    return;
  }

  if (state.restoreFocusId) {
    app.querySelector(`[data-lightbox-id="${cssEscape(state.restoreFocusId)}"]`)?.focus();
    state.restoreFocusId = null;
  }
}

function renderEmpty(payload) {
  headerSubtitle.textContent = payload?.generatedAt
    ? `Mis à jour le ${formatDateFr(new Date(payload.generatedAt), { year: 'numeric' })}`
    : 'Aucune mise à jour disponible';
  app.innerHTML = `
    <section class="empty-panel">
      <h2>Aucun menu disponible</h2>
      <p>Le fichier de données est chargé, mais il ne contient aucune semaine.</p>
    </section>
  `;
}

function renderError(error) {
  headerSubtitle.textContent = 'Mise à jour indisponible';
  app.innerHTML = `
    <section class="error-panel" role="alert">
      <h2>Impossible de charger les menus</h2>
      <p>La page n’a pas pu lire <code>menus.json</code>. Réessayez dans quelques instants.</p>
      <p class="muted">${escapeHtml(error.message)}</p>
    </section>
  `;
}

function hasUsableMenu(menu, day) {
  return !isClosedDay(menu, day) && cleanDayText(menu.dayTexts?.[day], day).some(line => !isClosedLine(line) && !isMetaLine(line));
}

function isClosedDay(menu, day) {
  const lines = cleanDayText(menu.dayTexts?.[day], day);
  return lines.some(isClosedLine) && !lines.some(line => !isClosedLine(line) && !isMetaLine(line));
}

function isClosedLine(line) {
  return CLOSED_RE.test(removeDiacritics(line));
}

function isMetaLine(line) {
  return normalizeText(line) === 'menu vegetarien';
}

function formatWeekRange(menu) {
  const start = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' }).format(menu.monday);
  const end = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(menu.friday);
  const startMonth = menu.monday.getMonth() === menu.friday.getMonth()
    ? ''
    : ` ${new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(menu.monday)}`;
  return `${start}${startMonth} au ${end}`;
}

function formatMenuTitle(day, date) {
  return `${day} ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date)}`;
}

function formatDayCardDate(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);
}

function formatDayCardDateShort(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long'
  }).format(date);
}

function getDayDate(menu, day) {
  return addDays(menu.monday, DAY_INDEX[day] || 0);
}

function parseIsoDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

function daysBetween(start, end) {
  return Math.round((startOfDay(end) - startOfDay(start)) / 86400000);
}

function dedupeAdjacent(lines) {
  const result = [];
  for (const line of lines) {
    if (normalizeText(line) !== normalizeText(result[result.length - 1] || '')) {
      result.push(line);
    }
  }
  return result;
}

function joinContinuationLines(lines) {
  const result = [];

  for (const line of lines) {
    const previous = result[result.length - 1];
    if (previous && shouldJoinLine(previous, line)) {
      result[result.length - 1] = `${previous} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      result.push(line);
    }
  }

  return result;
}

function shouldJoinLine(previous, line) {
  if (isClosedLine(previous) || isClosedLine(line) || isMetaLine(previous) || isMetaLine(line)) {
    return false;
  }

  const trimmedPrevious = previous.trim();
  const trimmedLine = line.trim();
  const firstLetter = trimmedLine.match(/\p{L}/u)?.[0] || '';

  return hasOpenParenthesis(trimmedPrevious) ||
    /[,(:;]$/.test(trimmedPrevious) ||
    /\b(et|à|a|de|du|des|aux|au|avec|sauce)$/i.test(removeDiacritics(trimmedPrevious)) ||
    /^[([{,;]/.test(trimmedLine) ||
    (firstLetter && firstLetter === firstLetter.toLowerCase());
}

function hasOpenParenthesis(text) {
  const opens = (text.match(/\(/g) || []).length;
  const closes = (text.match(/\)/g) || []).length;
  return opens > closes;
}

function formatMenuLine(line) {
  return splitParentheticalParts(line)
    .map(part => part.type === 'detail'
      ? `<span class="paren-detail">${escapeHtml(part.text)}</span>`
      : escapeHtml(part.text))
    .join('');
}

function splitParentheticalParts(line) {
  const text = String(line || '');
  const parts = [];
  let buffer = '';
  let depth = 0;
  let detail = false;

  for (const char of text) {
    if (char === '(') {
      if (detail) {
        buffer += char;
        depth += 1;
        continue;
      }

      if (buffer) {
        parts.push({ type: detail ? 'detail' : 'main', text: buffer });
      }
      buffer = '(';
      depth = 1;
      detail = true;
      continue;
    }

    if (char === ')' && detail) {
      buffer += char;
      depth -= 1;
      if (depth <= 0) {
        parts.push({ type: 'detail', text: buffer });
        buffer = '';
        detail = false;
      }
      continue;
    }

    buffer += char;
  }

  if (buffer) {
    parts.push({ type: detail ? 'detail' : 'main', text: buffer });
  }

  return parts;
}

function normalizeText(text) {
  return removeDiacritics(text)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

function removeDiacritics(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, '\\$&');
}
