import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(REPO_ROOT, 'dist', 'menu-cache');
const MENUS_DIR = join(OUT_DIR, 'menus');
const SOURCE_PAGE_URL = 'https://caissedesecolesparis13.fr/menus-cde13/';
const REST_URL = 'https://caissedesecolesparis13.fr/wp-json/wp/v2/pages?slug=menus-cde13';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; cde13-cache/1.0)',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'fr-FR,fr;q=0.9'
};

const MONTHS = {
  janvier: 0,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11
};

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(MENUS_DIR, { recursive: true });

  const html = await loadMenuHtml();
  const menus = extractMenus(html);

  if (!menus.length) {
    throw new Error('No menu-standard image was found in the CDE13 page.');
  }

  for (const menu of menus) {
    const filename = `menus/${menu.mondayDate}.jpg`;
    const imageBytes = await fetchBytes(menu.originalImageUrl);
    await writeFile(join(OUT_DIR, filename), imageBytes);
    menu.cachedImagePath = filename;
    menu.cachedImageUrl = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${filename}` : filename;
  }

  await writeFile(join(OUT_DIR, 'menus.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourcePageUrl: SOURCE_PAGE_URL,
    menus
  }, null, 2) + '\n');

  console.log(`Generated ${menus.length} cached menu(s) in ${OUT_DIR}`);
}

async function loadMenuHtml() {
  const direct = await tryFetchText(SOURCE_PAGE_URL);
  if (direct && hasMenuStandardImage(direct)) {
    return direct;
  }

  const restText = await tryFetchText(REST_URL);
  if (restText) {
    const pages = JSON.parse(restText);
    const html = pages?.[0]?.content?.rendered;
    if (html && hasMenuStandardImage(html)) {
      return html;
    }
  }

  return loadMenuHtmlWithPlaywright();
}

async function loadMenuHtmlWithPlaywright() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      locale: 'fr-FR',
      userAgent: FETCH_HEADERS['user-agent']
    });
    await page.goto(SOURCE_PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
    const html = await page.content();
    if (!hasMenuStandardImage(html)) {
      throw new Error('Playwright loaded the page, but no menu-standard image was found.');
    }
    return html;
  } finally {
    await browser.close();
  }
}

async function tryFetchText(url) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!response.ok) {
      console.warn(`${url} returned HTTP ${response.status}`);
      return null;
    }
    return response.text();
  } catch (error) {
    console.warn(`${url} failed: ${error.message}`);
    return null;
  }
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      ...FETCH_HEADERS,
      referer: SOURCE_PAGE_URL
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractMenus(html) {
  const imageUrls = uniqueMatches(
    html,
    /https:\/\/caissedesecolesparis13\.fr\/wp-content\/uploads\/pdf2img\/menu-standard-du-[^"' <]+\/page-001\.jpg/g
  );
  const pdfUrls = uniqueMatches(
    html,
    /https:\/\/caissedesecolesparis13\.fr\/wp-content\/uploads\/\d{4}\/\d{2}\/menu-standard-du-[^"' <]+\.pdf/g
  );

  return imageUrls
    .map(imageUrl => buildMenuInfo(imageUrl, pdfUrls))
    .filter(Boolean)
    .sort((a, b) => a.mondayDate.localeCompare(b.mondayDate));
}

function buildMenuInfo(originalImageUrl, pdfUrls) {
  const slug = originalImageUrl.match(/\/pdf2img\/([^/]+)\/page-001\.jpg$/)?.[1];
  if (!slug || slug.startsWith('allergenes-du-')) {
    return null;
  }

  const parsed = parseMenuSlug(slug);
  if (!parsed) {
    console.warn(`Unable to parse menu slug: ${slug}`);
    return null;
  }

  const pdfKey = slug.replace(/-\d+$/, '');
  const pdfUrl = pdfUrls.find(url => url.includes(`/${pdfKey}.pdf`)) || buildPdfUrl(pdfKey, parsed.mondayDate);

  return {
    weekLabel: parsed.weekLabel,
    mondayDate: parsed.mondayDate,
    pdfUrl,
    originalImageUrl
  };
}

function parseMenuSlug(slug) {
  const normalized = normalizeText(slug);
  let match = normalized.match(/^menu-standard-du-(\d{1,2})-au-(\d{1,2})-([a-z]+)-(\d{4})(?:-\d+)?$/);
  if (match) {
    return buildParsedMenuSlug({
      startDay: Number(match[1]),
      startMonthName: null,
      endDay: Number(match[2]),
      endMonthName: match[3],
      year: Number(match[4])
    });
  }

  match = normalized.match(/^menu-standard-du-(\d{1,2})-([a-z]+)-au-(\d{1,2})-([a-z]+)-(\d{4})(?:-\d+)?$/);
  if (!match) {
    return null;
  }

  return buildParsedMenuSlug({
    startDay: Number(match[1]),
    startMonthName: match[2],
    endDay: Number(match[3]),
    endMonthName: match[4],
    year: Number(match[5])
  });
}

function buildParsedMenuSlug({ startDay, startMonthName, endDay, endMonthName, year }) {
  const endMonth = MONTHS[endMonthName];
  let month = endMonth;

  if (endMonth === undefined) {
    return null;
  }

  if (startMonthName) {
    month = MONTHS[startMonthName];
  } else if (startDay > endDay) {
    month = endMonth - 1;
  }

  if (month < 0) {
    month = 11;
    year -= 1;
  }

  const mondayDate = formatIsoDate(new Date(Date.UTC(year, month, startDay)));
  const weekLabel = startMonthName
    ? `Menus de la semaine du ${pad2(startDay)} ${startMonthName} au ${pad2(endDay)} ${endMonthName} ${year}`
    : `Menus de la semaine du ${pad2(startDay)} au ${pad2(endDay)} ${endMonthName} ${year}`;

  return {
    mondayDate,
    weekLabel
  };
}

function buildPdfUrl(pdfKey, mondayDate) {
  const [year, month] = mondayDate.split('-');
  return `https://caissedesecolesparis13.fr/wp-content/uploads/${year}/${month}/${pdfKey}.pdf`;
}

function uniqueMatches(text, regex) {
  return [...new Set(text.match(regex) || [])];
}

function hasMenuStandardImage(html) {
  return /\/pdf2img\/menu-standard-du-[^/]+\/page-001\.jpg/.test(html);
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
