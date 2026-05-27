import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(REPO_ROOT, 'dist', 'menu-cache');
const MENUS_DIR = join(OUT_DIR, 'menus');
const OCR_CACHE_DIR = join(REPO_ROOT, '.cache', 'tesseract');
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

const DAY_CROPS = [
  { day: 'Lundi', slug: 'lundi', left: 123 / 1653, top: 395 / 2339, width: 596 / 1653, height: 571 / 2339 },
  { day: 'Mardi', slug: 'mardi', left: 927 / 1653, top: 395 / 2339, width: 596 / 1653, height: 571 / 2339 },
  { day: 'Mercredi', slug: 'mercredi', left: 123 / 1653, top: 1012 / 2339, width: 596 / 1653, height: 571 / 2339 },
  { day: 'Jeudi', slug: 'jeudi', left: 927 / 1653, top: 1012 / 2339, width: 596 / 1653, height: 571 / 2339 },
  { day: 'Vendredi', slug: 'vendredi', left: 123 / 1653, top: 1628 / 2339, width: 596 / 1653, height: 571 / 2339 }
];

async function main() {
  const previousMenus = await loadPreviousMenus();

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(MENUS_DIR, { recursive: true });

  const html = await loadMenuHtml();
  const menus = extractMenus(html).slice(-5);

  if (!menus.length) {
    throw new Error('No menu-standard image was found in the CDE13 page.');
  }

  const previousMenusByDate = new Map(previousMenus.map(menu => [menu.mondayDate, menu]));
  await mkdir(OCR_CACHE_DIR, { recursive: true });
  const worker = await createWorker('fra', 1, {
    cachePath: OCR_CACHE_DIR
  });
  const cachedMenus = [];

  try {
    for (const menu of menus) {
      const previousMenu = previousMenusByDate.get(menu.mondayDate);
      cachedMenus.push(await buildCachedMenu(menu, previousMenu, worker));
    }
  } finally {
    await worker.terminate();
  }

  await writeFile(join(OUT_DIR, 'menus.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourcePageUrl: SOURCE_PAGE_URL,
    menus: cachedMenus
  }, null, 2) + '\n');

  console.log(`Generated ${cachedMenus.length} cached menu(s) in ${OUT_DIR}`);
}

async function loadPreviousMenus() {
  const publicMenus = await loadPreviousMenusFromPublicCache();
  if (publicMenus.length) {
    return publicMenus;
  }

  return loadPreviousMenusFromLocalCache();
}

async function loadPreviousMenusFromPublicCache() {
  if (!PUBLIC_BASE_URL) {
    return [];
  }

  const cacheUrl = buildPublicUrl('menus.json');

  try {
    const response = await fetch(cacheUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!response.ok) {
      console.warn(`Previous public cache ${cacheUrl} returned HTTP ${response.status}`);
      return [];
    }

    const payload = JSON.parse(await response.text());
    return Array.isArray(payload?.menus) ? payload.menus : [];
  } catch (error) {
    console.warn(`Previous public cache ${cacheUrl} failed: ${error.message}`);
    return [];
  }
}

async function loadPreviousMenusFromLocalCache() {
  const localCachePath = join(OUT_DIR, 'menus.json');

  try {
    await access(localCachePath);
  } catch {
    return [];
  }

  try {
    const payload = JSON.parse(await readFile(localCachePath, 'utf8'));
    const menus = Array.isArray(payload?.menus) ? payload.menus : [];
    return Promise.all(menus.map(enrichMenuWithLocalAssets));
  } catch (error) {
    console.warn(`Previous local cache ${localCachePath} failed: ${error.message}`);
    return [];
  }
}

async function enrichMenuWithLocalAssets(menu) {
  return {
    ...menu,
    _localAssets: {
      cachedImageBytes: await tryReadLocalAsset(menu.cachedImagePath),
      dayImageBytes: await readLocalDayAssets(menu.dayImageUrls)
    }
  };
}

async function readLocalDayAssets(dayImageUrls) {
  const assets = {};
  for (const crop of DAY_CROPS) {
    const relativePath = extractRelativeAssetPath(dayImageUrls?.[crop.day]);
    assets[crop.day] = await tryReadLocalAsset(relativePath);
  }
  return assets;
}

async function buildCachedMenu(menu, previousMenu, worker) {
  if (canReuseMenu(previousMenu, menu)) {
    try {
      await restoreMenuAssets(previousMenu, menu.mondayDate);
      return {
        weekLabel: menu.weekLabel,
        mondayDate: menu.mondayDate,
        pdfUrl: menu.pdfUrl,
        originalImageUrl: menu.originalImageUrl,
        cachedImagePath: buildCachedImagePath(menu.mondayDate),
        cachedImageUrl: buildPublicUrl(buildCachedImagePath(menu.mondayDate)),
        dayImageUrls: buildDayImageUrls(menu.mondayDate),
        dayTexts: normalizeDayTexts(previousMenu.dayTexts),
        ocrEngine: previousMenu.ocrEngine || 'tesseract-fra',
        ocrGeneratedAt: previousMenu.ocrGeneratedAt || new Date().toISOString()
      };
    } catch (error) {
      console.warn(`Unable to restore cached assets for ${menu.mondayDate}: ${error.message}`);
    }
  }

  return generateMenuEntry(menu, worker);
}

function canReuseMenu(previousMenu, menu) {
  return Boolean(
    previousMenu &&
    previousMenu.originalImageUrl === menu.originalImageUrl &&
    hasCompleteDayValues(previousMenu.dayTexts) &&
    hasCompleteDayValues(previousMenu.dayImageUrls) &&
    previousMenu.cachedImageUrl
  );
}

function hasCompleteDayValues(values) {
  return DAY_CROPS.every(crop => typeof values?.[crop.day] === 'string' && values[crop.day].trim());
}

async function restoreMenuAssets(previousMenu, mondayDate) {
  const cachedImagePath = buildCachedImagePath(mondayDate);
  await writeAssetFromSource(previousMenu.cachedImageUrl, previousMenu.cachedImagePath, previousMenu._localAssets?.cachedImageBytes, cachedImagePath);

  for (const crop of DAY_CROPS) {
    const relativePath = buildDayCropPath(mondayDate, crop.slug);
    await writeAssetFromSource(previousMenu.dayImageUrls[crop.day], relativePath, previousMenu._localAssets?.dayImageBytes?.[crop.day], relativePath);
  }
}

async function writeAssetFromSource(url, fallbackPath, cachedBytes, relativeOutputPath) {
  let bytes = cachedBytes || null;

  if (!bytes && url && /^https?:\/\//.test(url)) {
    bytes = await tryFetchBytes(url);
  }

  if (!bytes && fallbackPath && !PUBLIC_BASE_URL) {
    bytes = await tryReadLocalAsset(fallbackPath);
  }

  if (!bytes) {
    throw new Error(`Asset unavailable for ${relativeOutputPath}`);
  }

  const outputPath = join(OUT_DIR, relativeOutputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
}

async function tryFetchBytes(url) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!response.ok) {
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function tryReadLocalAsset(relativePath) {
  if (!relativePath) {
    return null;
  }

  const localPath = join(OUT_DIR, relativePath);
  try {
    return await readFile(localPath);
  } catch {
    return null;
  }
}

function extractRelativeAssetPath(url) {
  if (!url || /^https?:\/\//.test(url)) {
    return null;
  }
  return String(url).replace(/^\//, '');
}

async function generateMenuEntry(menu, worker) {
  const imageBytes = await fetchBytes(menu.originalImageUrl);
  const cachedImagePath = buildCachedImagePath(menu.mondayDate);
  await writeFile(join(OUT_DIR, cachedImagePath), imageBytes);

  const dayArtifacts = await writeDayArtifacts(menu.mondayDate, imageBytes, worker);

  return {
    weekLabel: menu.weekLabel,
    mondayDate: menu.mondayDate,
    pdfUrl: menu.pdfUrl,
    originalImageUrl: menu.originalImageUrl,
    cachedImagePath,
    cachedImageUrl: buildPublicUrl(cachedImagePath),
    dayImageUrls: dayArtifacts.dayImageUrls,
    dayTexts: dayArtifacts.dayTexts,
    ocrEngine: 'tesseract-fra',
    ocrGeneratedAt: new Date().toISOString()
  };
}

async function writeDayArtifacts(mondayDate, imageBytes, worker) {
  const image = sharp(imageBytes);
  const metadata = await image.metadata();
  const dayImageUrls = {};
  const dayTexts = {};
  const dayDir = `menus/${mondayDate}`;
  await mkdir(join(OUT_DIR, dayDir), { recursive: true });

  for (const crop of DAY_CROPS) {
    const filename = `${dayDir}/${crop.slug}.jpg`;
    const region = {
      left: Math.round(metadata.width * crop.left),
      top: Math.round(metadata.height * crop.top),
      width: Math.round(metadata.width * crop.width),
      height: Math.round(metadata.height * crop.height)
    };

    const cropBuffer = await sharp(imageBytes)
      .extract(region)
      .jpeg({ quality: 92 })
      .toBuffer();
    const ocrBuffer = await preprocessCropForOcr(cropBuffer);

    await writeFile(join(OUT_DIR, filename), cropBuffer);

    dayImageUrls[crop.day] = buildPublicUrl(filename);
    dayTexts[crop.day] = await recognizeDayText(worker, ocrBuffer, crop.day);
  }

  return { dayImageUrls, dayTexts };
}

async function preprocessCropForOcr(cropBuffer) {
  const image = sharp(cropBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const headerY = Math.min(height, 108);
  const maskWidth = Math.min(width, 50);
  const masked = await image
    .composite([{
      input: {
        create: {
          width: maskWidth,
          height: Math.max(1, height - headerY),
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      },
      left: Math.max(0, width - maskWidth),
      top: headerY
    }])
    .toBuffer();

  return sharp(masked)
    .resize({
      width: Math.round(width * 1.35),
      withoutEnlargement: false
    })
    .grayscale()
    .normalize()
    .linear(1.2, -(255 * 0.1))
    .sharpen()
    .threshold(182)
    .png()
    .toBuffer();
}

async function recognizeDayText(worker, cropBuffer, day) {
  const {
    data: { text, tsv }
  } = await worker.recognize(cropBuffer, {}, { tsv: true });

  const structuredText = await buildFilteredTextFromTsv(tsv, cropBuffer);
  return ensureDayPrefix(normalizeOcrText(structuredText || text), day);
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildFilteredTextFromTsv(tsv, imageBuffer) {
  if (!tsv) {
    return '';
  }

  const rows = parseTsvRows(tsv);
  if (!rows.length) {
    return '';
  }

  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const linesByKey = new Map();

  for (const row of rows) {
    if (row.level !== 5 || !row.text) {
      continue;
    }

    const key = `${row.page_num}:${row.block_num}:${row.par_num}:${row.line_num}`;
    if (!linesByKey.has(key)) {
      linesByKey.set(key, []);
    }
    linesByKey.get(key).push(row);
  }

  const lines = [...linesByKey.values()]
    .map(words => words.sort((a, b) => a.left - b.left))
    .map(words => filterLineWords(words, imageWidth))
    .filter(words => words.length)
    .map(words => words.map(word => word.text).join(' ').replace(/\s+([,.)])/g, '$1'))
    .filter(Boolean);

  return lines.join('\n');
}

function parseTsvRows(tsv) {
  return tsv
    .trim()
    .split('\n')
    .map(line => line.split('\t'))
    .filter(columns => columns.length >= 12)
    .map(columns => ({
      level: Number(columns[0]),
      page_num: Number(columns[1]),
      block_num: Number(columns[2]),
      par_num: Number(columns[3]),
      line_num: Number(columns[4]),
      word_num: Number(columns[5]),
      left: Number(columns[6]),
      top: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      conf: Number(columns[10]),
      text: String(columns[11] || '').trim()
    }));
}

function filterLineWords(words, imageWidth) {
  const lineHeight = Math.max(...words.map(word => word.height || 0), 0);

  return words.filter(word => !isLikelyRightMarginNoise(word, imageWidth, lineHeight));
}

function isLikelyRightMarginNoise(word, imageWidth, lineHeight) {
  const text = String(word.text || '').trim();
  if (!text) {
    return true;
  }

  const rightSide = imageWidth > 0 && word.left >= imageWidth * 0.84;
  const tinyToken = /^[A-Za-zÀ-ÿ0-9|&€#]{1,3}$/.test(text);
  const lowConfidence = word.conf >= 0 && word.conf < 75;
  const shortHeight = lineHeight > 0 && word.height < lineHeight * 0.75;
  const narrowWord = imageWidth > 0 && word.width < imageWidth * 0.12;
  const suspiciousTinyToken = tinyToken && !isAllowedShortWord(text) && /[A-Z0-9|&€#]/.test(text);

  return rightSide && narrowWord && (suspiciousTinyToken || lowConfidence || shortHeight);
}

function isAllowedShortWord(text) {
  const normalized = normalizeOcrText(text).toLowerCase();
  return normalized === 'de' || normalized === 'du' || normalized === 'des' || normalized === 'au' || normalized === 'aux' || normalized === 'et';
}

function normalizeDayTexts(dayTexts) {
  const normalized = {};
  for (const crop of DAY_CROPS) {
    normalized[crop.day] = ensureDayPrefix(normalizeOcrText(dayTexts?.[crop.day] || ''), crop.day);
  }
  return normalized;
}

function ensureDayPrefix(text, day) {
  const cleaned = normalizeOcrText(text);
  if (!cleaned) {
    return day;
  }

  if (normalizeText(cleaned).startsWith(normalizeText(day))) {
    return cleaned;
  }

  return `${day}\n${cleaned}`;
}

function buildCachedImagePath(mondayDate) {
  return `menus/${mondayDate}.jpg`;
}

function buildDayCropPath(mondayDate, slug) {
  return `menus/${mondayDate}/${slug}.jpg`;
}

function buildDayImageUrls(mondayDate) {
  const urls = {};
  for (const crop of DAY_CROPS) {
    urls[crop.day] = buildPublicUrl(buildDayCropPath(mondayDate, crop.slug));
  }
  return urls;
}

function buildPublicUrl(relativePath) {
  const normalizedPath = relativePath.replace(/^\//, '');
  if (!PUBLIC_BASE_URL) {
    return normalizedPath;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${normalizedPath}`;
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
    /https:\/\/caissedesecolesparis13\.fr\/wp-content\/uploads\/pdf2img\/(?:menu-standard-du|menu-de-la-semaine-du)-[^"' <]+\/page-001\.jpg/g
  );
  const pdfUrls = uniqueMatches(
    html,
    /https:\/\/caissedesecolesparis13\.fr\/wp-content\/uploads\/\d{4}\/\d{2}\/(?:menu-standard-du|menu-de-la-semaine-du)-[^"' <]+\.pdf/g
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
  let match = normalized.match(/^menu(?:-standard|-de-la-semaine)-du-(\d{1,2})-au-(\d{1,2})-([a-z]+)-(\d{4})(?:-\d+)?$/);
  if (match) {
    return buildParsedMenuSlug({
      startDay: Number(match[1]),
      startMonthName: null,
      endDay: Number(match[2]),
      endMonthName: match[3],
      year: Number(match[4])
    });
  }

  match = normalized.match(/^menu(?:-standard|-de-la-semaine)-du-(\d{1,2})-([a-z]+)-au-(\d{1,2})-([a-z]+)-(\d{4})(?:-\d+)?$/);
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
  return /\/pdf2img\/(?:menu-standard-du|menu-de-la-semaine-du)-[^/]+\/page-001\.jpg/.test(html);
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
