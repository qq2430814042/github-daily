import { load } from 'cheerio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'docs', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const TIME_ZONE = 'Asia/Shanghai';
const CAP = 60;
const MAX_BACKFILL = 30;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const SEARCH_DELAY = TOKEN ? 1200 : 6000;
const SOURCE_ORDER = ['trending', 'new', 'high-star'];

let searchCalls = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(isoDate, amount) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const match = String(value).replace(/,/g, '').match(/([\d.]+)\s*([kKmM])?/);
  if (!match) return 0;
  let number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'k') number *= 1e3;
  if (unit === 'm') number *= 1e6;
  return Math.round(number);
}

function cleanText(value, maxLength = 300) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSearchItem(item) {
  return {
    fullName: item.full_name,
    name: item.name,
    owner: item.owner?.login || '',
    url: item.html_url,
    description: cleanText(item.description),
    language: item.language || '',
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    starsToday: 0,
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 8) : [],
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    sources: [],
    isNew: false,
  };
}

function mergeItems(groups) {
  const map = new Map();

  for (const { source, items } of groups) {
    for (const item of items) {
      const key = item.fullName.toLowerCase();
      const current = map.get(key);

      if (!current) {
        map.set(key, {
          ...item,
          starsToday: item.starsToday || 0,
          sources: [source],
        });
        continue;
      }

      current.stars = Math.max(current.stars || 0, item.stars || 0);
      current.forks = Math.max(current.forks || 0, item.forks || 0);
      current.starsToday = Math.max(current.starsToday || 0, item.starsToday || 0);
      current.isNew = current.isNew || item.isNew;
      if (!current.description && item.description) current.description = item.description;
      if (!current.language && item.language) current.language = item.language;
      if (!current.createdAt && item.createdAt) current.createdAt = item.createdAt;
      if (!current.updatedAt && item.updatedAt) current.updatedAt = item.updatedAt;
      if ((!current.topics || !current.topics.length) && item.topics?.length) {
        current.topics = item.topics;
      }
      current.sources = SOURCE_ORDER.filter(
        (name) => current.sources.includes(name) || name === source,
      );
    }
  }

  return [...map.values()];
}

function score(item) {
  return (
    (item.starsToday || 0) * 100 +
    (item.isNew ? 30 : 0) +
    Math.log10((item.stars || 0) + 1)
  );
}

function selectItems(allItems) {
  const bySource = {
    trending: allItems
      .filter((item) => item.sources.includes('trending'))
      .sort((a, b) => b.starsToday - a.starsToday || b.stars - a.stars),
    new: allItems
      .filter((item) => item.sources.includes('new'))
      .sort((a, b) => b.stars - a.stars),
    high: allItems
      .filter((item) => item.sources.includes('high-star'))
      .sort((a, b) => b.stars - a.stars),
  };

  const picked = [];
  const seen = new Set();

  const take = (list, limit) => {
    for (const item of list) {
      if (limit <= 0 || picked.length >= CAP) break;
      const key = item.fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(item);
      limit -= 1;
    }
  };

  take(bySource.trending, 25);
  take(bySource.high, 12);
  take(bySource.new, CAP);

  const remaining = [...allItems].sort(
    (a, b) => score(b) - score(a) || b.stars - a.stars,
  );
  take(remaining, CAP);

  return picked.sort(
    (a, b) =>
      score(b) - score(a) ||
      b.stars - a.stars ||
      a.fullName.localeCompare(b.fullName),
  );
}

async function fetchTrending() {
  const response = await fetch('https://github.com/trending?since=daily', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; github-daily/1.0)',
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Trending returned HTTP ${response.status}`);
  }

  const $ = load(await response.text());
  const items = [];

  $('article.Box-row').each((_, element) => {
    const row = $(element);
    const href = row.find('h2 a').first().attr('href');
    if (!href) return;

    const fullName = href.replace(/^\/+|\/+$/g, '');
    if (fullName.split('/').length !== 2) return;

    const [owner, name] = fullName.split('/');
    const starsTodayMatch = row.text().match(/([\d,.]+)\s*[kKmM]?\s+stars?\s+today/i);

    items.push({
      fullName,
      name,
      owner,
      url: `https://github.com/${fullName}`,
      description: cleanText(row.find('p').first().text()),
      language: row.find('[itemprop="programmingLanguage"]').first().text().trim(),
      stars: parseNumber(row.find('a[href$="/stargazers"]').first().text()),
      forks: parseNumber(row.find('a[href$="/forks"]').first().text()),
      starsToday: starsTodayMatch ? parseNumber(starsTodayMatch[0]) : 0,
      topics: [],
      createdAt: null,
      updatedAt: null,
      sources: ['trending'],
      isNew: false,
    });
  });

  const unique = new Map();
  for (const item of items) {
    unique.set(item.fullName.toLowerCase(), item);
  }
  return [...unique.values()];
}

async function githubSearch(query, perPage) {
  if (searchCalls > 0) await sleep(SEARCH_DELAY);
  searchCalls += 1;

  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(perPage));

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-daily/1.0',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers });

    if (response.ok) {
      const data = await response.json();
      return (data.items || []).map(normalizeSearchItem);
    }

    const body = await response.text().catch(() => '');
    lastError = new Error(
      `GitHub search HTTP ${response.status}: ${cleanText(body, 200)}`,
    );

    if ((response.status === 403 || response.status === 429) && attempt < 3) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const wait = Number.isFinite(reset) && reset > Date.now()
        ? Math.max(5000, reset - Date.now())
        : 30000;
      const seconds = Math.min(Math.ceil(wait / 1000), 90);
      console.warn(`Rate limited, waiting ${seconds}s before retry...`);
      await sleep(seconds * 1000);
      continue;
    }

    break;
  }

  throw lastError;
}

async function safeSearch(label, query, perPage) {
  try {
    return await githubSearch(query, perPage);
  } catch (error) {
    console.warn(`[${label}] ${error.message}`);
    return [];
  }
}

async function buildDate(date, trendingItems) {
  const newItems = await safeSearch(
    `${date} new`,
    `created:${date} stars:>=3`,
    40,
  );
  const highItems = await safeSearch(
    `${date} high-star`,
    `stars:>=1000 pushed:${date} archived:false`,
    20,
  );

  const freshItems = newItems
    .filter((item) => item.stars >= 5)
    .map((item) => ({ ...item, isNew: true, sources: ['new'] }));
  const popularItems = highItems.map((item) => ({
    ...item,
    isNew: false,
    sources: ['high-star'],
  }));

  const merged = mergeItems([
    { source: 'trending', items: trendingItems },
    { source: 'new', items: freshItems },
    { source: 'high-star', items: popularItems },
  ]);

  if (!merged.length) return null;

  const selected = selectItems(merged);
  const items = selected.map((item, index) => ({ rank: index + 1, ...item }));

  return {
    date,
    timezone: TIME_ZONE,
    generatedAt: new Date().toISOString(),
    count: items.length,
    newCount: items.filter((item) => item.isNew).length,
    sources: {
      trending: items.filter((item) => item.sources.includes('trending')).length,
      new: items.filter((item) => item.sources.includes('new')).length,
      highStar: items.filter((item) => item.sources.includes('high-star')).length,
    },
    items,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = shanghaiDate();
  const endDate = typeof args.date === 'string' ? args.date : addDays(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid --date value: ${endDate}`);
  }

  const backfill = Math.min(
    MAX_BACKFILL,
    Math.max(1, Number.parseInt(args.backfill, 10) || 1),
  );
  const dates = Array.from({ length: backfill }, (_, index) =>
    addDays(endDate, -(backfill - 1 - index)),
  );

  console.log(
    `Fetching ${dates.length} day(s): ${dates[0]} -> ${dates[dates.length - 1]}`,
  );

  const latestDate = dates[dates.length - 1];
  const shouldUseTrending = latestDate === today || latestDate === addDays(today, -1);
  let trendingItems = [];

  if (shouldUseTrending) {
    try {
      trendingItems = await fetchTrending();
      console.log(`Trending: ${trendingItems.length} repositories`);
    } catch (error) {
      console.warn(`Trending unavailable, continuing without it: ${error.message}`);
    }
  }

  await mkdir(DATA_DIR, { recursive: true });

  const written = [];
  const failedDates = [];

  for (const date of dates) {
    const isLatest = date === latestDate;
    const payload = await buildDate(date, isLatest ? trendingItems : []);

    if (!payload) {
      console.warn(`[${date}] No data fetched, keeping previous file if any`);
      failedDates.push(date);
      continue;
    }

    const file = path.join(DATA_DIR, `${date}.json`);
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    written.push(payload);
    console.log(
      `[${date}] saved ${payload.count} items ` +
        `(trending ${payload.sources.trending}, new ${payload.sources.new}, high-star ${payload.sources.highStar})`,
    );
  }

  const previousIndex = await readJson(INDEX_FILE, { dates: [] });
  const entries = new Map();

  for (const entry of previousIndex.dates || []) {
    const normalized = typeof entry === 'string'
      ? { date: entry, count: 0, newCount: 0 }
      : entry;
    if (normalized?.date) entries.set(normalized.date, normalized);
  }

  for (const payload of written) {
    entries.set(payload.date, {
      date: payload.date,
      count: payload.count,
      newCount: payload.newCount,
    });
  }

  const index = {
    updatedAt: new Date().toISOString(),
    dates: [...entries.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };

  await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Index updated, ${index.dates.length} date(s) available`);

  if (!written.some((payload) => payload.date === latestDate)) {
    throw new Error(`No data written for latest target date ${latestDate}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
