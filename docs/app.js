const FAVORITES_KEY = 'github-daily:favorites:v1';
const TRANSLATIONS_KEY = 'github-daily:translations:v1';
const FULL_TRANSLATIONS_KEY = 'github-daily:full-translations:v1';
const HIGH_STAR = 1000;
const TRANSLATE_CHUNK_SIZE = 480;

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Shell: '#89e051',
  Ruby: '#701516',
  PHP: '#4f5d95',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Dart: '#00b4ab',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Zig: '#ec915c',
  Lua: '#000080',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Scala: '#c22d40',
  'Jupyter Notebook': '#da5b0b',
};

const state = {
  dates: [],
  date: '',
  data: null,
  items: [],
  status: 'empty',
  tab: 'all',
  query: '',
  language: '',
  sort: 'default',
  favorites: loadFavorites(),
  translations: loadTranslations(),
  fullTranslations: loadFullTranslations(),
  detail: null,
  fullTranslation: null,
  fullTranslationToken: 0,
  translationMode: 'original',
  translating: false,
  readmeToken: 0,
  readmeText: '',
  readmeLoaded: false,
};

const els = {
  list: document.getElementById('list'),
  meta: document.getElementById('meta'),
  dateSelect: document.getElementById('dateSelect'),
  prevDate: document.getElementById('prevDate'),
  nextDate: document.getElementById('nextDate'),
  search: document.getElementById('search'),
  language: document.getElementById('language'),
  sort: document.getElementById('sort'),
  favCount: document.getElementById('favCount'),
  tabs: [...document.querySelectorAll('.tab')],
  detailOverlay: document.getElementById('detailOverlay'),
  detailDialog: document.getElementById('detailDialog'),
  detailTitle: document.getElementById('detailTitle'),
  detailDesc: document.getElementById('detailDesc'),
  detailMeta: document.getElementById('detailMeta'),
  detailTranslate: document.getElementById('detailTranslate'),
  detailGithub: document.getElementById('detailGithub'),
  detailBaidu: document.getElementById('detailBaidu'),
  detailClose: document.getElementById('detailClose'),
  detailBack: document.getElementById('detailBack'),
  sharePage: document.getElementById('sharePage'),
  toast: document.getElementById('toast'),
  translationNote: document.getElementById('translationNote'),
  readmeSection: document.getElementById('readmeSection'),
  readmeStatus: document.getElementById('readmeStatus'),
  detailReadme: document.getElementById('detailReadme'),
};

let loadToken = 0;
let lastDetailFocus = null;
const readmeCache = new Map();

function create(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN').format(number);
}

function formatDate(isoDate) {
  const [year, month, day] = String(isoDate).split('-');
  if (!year || !month || !day) return isoDate;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function weekdayOf(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function safeGitHubUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'github.com') return url.href;
  } catch {
    // Invalid URLs fall through to the placeholder.
  }
  return '#';
}

function languageColor(language) {
  return LANGUAGE_COLORS[language] || 'var(--muted)';
}

function keyOf(item) {
  return String(item?.fullName || '').toLowerCase();
}

function cleanItem(item) {
  const { savedAt, ...rest } = item;
  return rest;
}

function loadFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const favorites = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry?.item?.fullName) favorites[key] = entry;
    }
    return favorites;
  } catch {
    return {};
  }
}

function persistFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
  } catch (error) {
    console.warn('Unable to save favorites', error);
  }
}

function loadTranslations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRANSLATIONS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistTranslations() {
  const entries = Object.entries(state.translations);
  if (entries.length > 600) {
    entries.sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || '')));
    state.translations = Object.fromEntries(entries.slice(0, 500));
  }

  try {
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(state.translations));
  } catch (error) {
    console.warn('Unable to save translations', error);
  }
}

function translationKey(item, text) {
  return `${keyOf(item)}::${text}`;
}

function loadFullTranslations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FULL_TRANSLATIONS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistFullTranslations() {
  const entries = Object.entries(state.fullTranslations);
  if (entries.length > 30) {
    entries.sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || '')));
    state.fullTranslations = Object.fromEntries(entries.slice(0, 25));
  }

  try {
    localStorage.setItem(
      FULL_TRANSLATIONS_KEY,
      JSON.stringify(state.fullTranslations),
    );
  } catch (error) {
    console.warn('Unable to save full translations', error);
  }
}

function fullTranslationKey(item, readmeText) {
  const description = String(item?.description || '').trim();
  return [
    keyOf(item),
    item?.readmeFile || '',
    description.length,
    readmeText.length,
    description.slice(0, 40),
    readmeText.slice(0, 40),
  ].join('::');
}

function isMostlyChinese(text) {
  const source = String(text || '');
  if (!source) return false;
  const cjk = (source.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > source.length * 0.3;
}

function splitTranslationChunks(text, maxLength = TRANSLATE_CHUNK_SIZE) {
  const chunks = [];
  let rest = String(text || '').trim();

  while (rest && chunks.length < 30) {
    if (rest.length <= maxLength) {
      chunks.push(rest);
      break;
    }

    const window = rest.slice(0, maxLength);
    const breakIndex = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    );

    const end = breakIndex > maxLength * 0.4 ? breakIndex + 2 : maxLength;
    const chunk = rest.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(end).trim();
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(value) {
  const documentFragment = new DOMParser().parseFromString(
    `<body>${value}</body>`,
    'text/html',
  );
  return documentFragment.body.textContent || '';
}

function baiduTranslateUrl(text) {
  return `https://fanyi.baidu.com/#en/zh/${encodeURIComponent(text)}`;
}

function updateFavCount() {
  const count = Object.keys(state.favorites).length;
  els.favCount.textContent = count ? String(count) : '';
  els.favCount.hidden = count === 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function normalizeDates(index) {
  const raw = Array.isArray(index?.dates) ? index.dates : [];
  const map = new Map();

  for (const entry of raw) {
    const date = typeof entry === 'string' ? entry : entry?.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
    map.set(date, {
      date,
      count: Number(typeof entry === 'object' ? entry.count : 0) || 0,
      newCount: Number(typeof entry === 'object' ? entry.newCount : 0) || 0,
    });
  }

  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function populateDateSelect() {
  els.dateSelect.replaceChildren();

  if (!state.dates.length) {
    const option = create('option', '', '暂无数据');
    option.value = '';
    els.dateSelect.append(option);
    return;
  }

  for (const entry of state.dates) {
    const option = create('option', '', formatDate(entry.date));
    option.value = entry.date;
    els.dateSelect.append(option);
  }

  const target = state.date || state.dates[0].date;
  if (state.dates.some((entry) => entry.date === target)) {
    els.dateSelect.value = target;
  }
}

function updateDateNav() {
  const disabledBase = state.tab === 'fav' || !state.dates.length;
  const index = state.dates.findIndex((entry) => entry.date === state.date);

  els.dateSelect.disabled = disabledBase;
  els.prevDate.disabled = disabledBase || index < 0 || index >= state.dates.length - 1;
  els.nextDate.disabled = disabledBase || index <= 0;
}

function baseItemsForTab() {
  if (state.tab === 'fav') {
    return Object.values(state.favorites).map((entry) => entry.item);
  }
  if (state.tab === 'new') return state.items.filter((item) => item.isNew);
  if (state.tab === 'high') return state.items.filter((item) => item.stars >= HIGH_STAR);
  return state.items;
}

function populateLanguages() {
  const languages = [
    ...new Set(baseItemsForTab().map((item) => item.language).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const current = state.language;
  els.language.replaceChildren();

  const all = create('option', '', '全部语言');
  all.value = '';
  els.language.append(all);

  for (const language of languages) {
    const option = create('option', '', language);
    option.value = language;
    els.language.append(option);
  }

  if (languages.includes(current)) {
    els.language.value = current;
  } else {
    state.language = '';
    els.language.value = '';
  }
}

function getVisibleItems() {
  let list;

  if (state.tab === 'fav') {
    list = Object.values(state.favorites).map((entry) => {
      const current = state.items.find((item) => keyOf(item) === keyOf(entry.item));
      return {
        ...entry.item,
        ...(current || {}),
        savedAt: entry.savedAt,
      };
    });
  } else {
    list = [...baseItemsForTab()];
  }

  if (state.language) {
    list = list.filter((item) => item.language === state.language);
  }

  const query = state.query.trim().toLowerCase();
  if (query) {
    list = list.filter((item) => {
      const haystack = [
        item.fullName,
        item.description,
        item.language,
        ...(Array.isArray(item.topics) ? item.topics : []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  if (state.sort === 'stars') {
    list.sort((a, b) => b.stars - a.stars || keyOf(a).localeCompare(keyOf(b)));
  } else if (state.sort === 'today') {
    list.sort(
      (a, b) =>
        (b.starsToday || 0) - (a.starsToday || 0) ||
        b.stars - a.stars ||
        keyOf(a).localeCompare(keyOf(b)),
    );
  } else if (state.sort === 'created') {
    list.sort(
      (a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
        b.stars - a.stars,
    );
  } else if (state.tab === 'fav') {
    list.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  } else {
    list.sort((a, b) => (a.rank || 0) - (b.rank || 0));
  }

  return list;
}

function renderMeta(items) {
  if (state.tab === 'fav') {
    const total = Object.keys(state.favorites).length;
    let text = `收藏 ${total} 个仓库`;
    if (items.length !== total) text += ` · 当前显示 ${items.length} 个`;
    els.meta.textContent = text;
    return;
  }

  if (!state.data) {
    els.meta.textContent = state.date && state.status === 'loading'
      ? `${formatDate(state.date)} · 加载中…`
      : '';
    return;
  }

  let text =
    `${formatDate(state.data.date)} ${weekdayOf(state.data.date)} · ` +
    `${state.data.count} 个仓库 · ${state.data.newCount} 个新项目`;

  if (items.length !== state.data.count) {
    text += ` · 筛选出 ${items.length} 个`;
  }

  els.meta.textContent = text;
}

function renderMessage(title, hint) {
  els.list.replaceChildren();
  const box = create('div', 'message');
  box.append(create('p', '', title));
  if (hint) box.append(create('p', 'hint', hint));
  els.list.append(box);
}

function renderLoading() {
  els.list.replaceChildren();
  const box = create('div', 'message');
  box.append(create('div', 'spinner'));
  box.append(create('p', '', '正在加载榜单…'));
  els.list.append(box);
}

function renderEmptyForCurrentView() {
  const favoritesCount = Object.keys(state.favorites).length;
  const hasFilters = Boolean(state.query.trim() || state.language);

  if (state.tab === 'fav' && !favoritesCount) {
    renderMessage('还没有收藏', '点击卡片右上角的星标即可收藏。');
    return;
  }

  if (hasFilters) {
    renderMessage('没有匹配的仓库', '试试清除搜索词或切换筛选条件。');
    return;
  }

  if (state.tab === 'new') {
    renderMessage('这一天没有新项目', '切到「全部」看看其他仓库。');
    return;
  }

  if (state.tab === 'high') {
    renderMessage('这一天没有高星仓库', '高星指总 Star 超过 1000 的仓库。');
    return;
  }

  renderMessage('这一天还没有数据', '稍后再来看看。');
}

function createCard(item, index) {
  const card = create('article', 'card');
  card.append(create('div', 'rank', String(index + 1).padStart(2, '0')));

  const main = create('div', 'card-main');
  const titleRow = create('div', 'title-row');

  const titleButton = create('button', 'repo-link');
  titleButton.type = 'button';
  titleButton.title = item.fullName || '';
  titleButton.setAttribute('aria-label', `查看 ${item.fullName || '仓库'} 的详情`);
  titleButton.addEventListener('click', () => openDetail(item));

  const fullName = String(item.fullName || '');
  const slash = fullName.indexOf('/');
  if (slash > 0) {
    titleButton.append(document.createTextNode(fullName.slice(0, slash + 1)));
    titleButton.append(create('strong', '', fullName.slice(slash + 1)));
  } else {
    titleButton.textContent = fullName || '未知仓库';
  }

  titleRow.append(titleButton);
  if (item.isNew) titleRow.append(create('span', 'badge', 'NEW'));
  main.append(titleRow);

  const description = String(item.description || '').trim();
  const desc = create(
    'p',
    description ? 'desc' : 'desc is-empty',
    description || '暂无描述',
  );
  if (description) desc.title = description;
  main.append(desc);

  const tags = create('div', 'tags');

  if (item.language) {
    const language = create('span', 'tag');
    const dot = create('span', 'lang-dot');
    dot.style.backgroundColor = languageColor(item.language);
    language.append(dot, document.createTextNode(item.language));
    tags.append(language);
  }

  const stars = create('span', 'tag');
  const starsText = create('span', 'stars', `★ ${formatNumber(item.stars)}`);
  stars.title = '总 Star 数';
  stars.append(starsText);
  tags.append(stars);

  if (item.starsToday > 0) {
    const today = create('span', 'today', `↑ ${formatNumber(item.starsToday)} 今日`);
    today.title = '今日新增 Star';
    tags.append(today);
  }

  const topics = Array.isArray(item.topics) ? item.topics : [];
  for (const topic of topics.slice(0, 3)) {
    tags.append(create('span', 'tag topic', `#${topic}`));
  }

  const detailButton = create('button', 'detail-link', '详情 / 翻译');
  detailButton.type = 'button';
  detailButton.setAttribute('aria-label', `查看 ${item.fullName || '仓库'} 的详情和翻译`);
  detailButton.addEventListener('click', () => openDetail(item));
  tags.append(detailButton);

  main.append(tags);
  card.append(main);

  const key = keyOf(item);
  const isFavorite = Boolean(state.favorites[key]);
  const favButton = create('button', 'fav-btn');
  favButton.type = 'button';
  favButton.textContent = '★';
  favButton.setAttribute('aria-pressed', String(isFavorite));
  favButton.setAttribute('aria-label', isFavorite ? '取消收藏' : '收藏');
  favButton.title = isFavorite ? '取消收藏' : '收藏';
  favButton.addEventListener('click', () => toggleFavorite(item));
  card.append(favButton);

  card.classList.add('is-clickable');
  card.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) return;
    openDetail(item);
  });

  return card;
}

function toggleFavorite(item) {
  const key = keyOf(item);
  if (!key) return;

  if (state.favorites[key]) {
    delete state.favorites[key];
  } else {
    state.favorites[key] = {
      item: cleanItem(item),
      savedAt: new Date().toISOString(),
    };
  }

  persistFavorites();
  updateFavCount();

  if (state.tab === 'fav') populateLanguages();
  render();
}

function addDetailMeta(container, className, text) {
  container.append(create('span', className, text));
}

function openDetail(item) {
  state.detail = item;
  state.fullTranslationToken += 1;
  state.fullTranslation = null;
  state.translationMode = 'original';
  state.translating = false;
  state.readmeToken += 1;
  state.readmeText = '';
  state.readmeLoaded = false;

  els.translationNote.hidden = true;
  els.translationNote.classList.remove('is-error');
  els.translationNote.textContent = '';
  els.detailTranslate.textContent = '翻译全文';
  els.detailTranslate.disabled = true;

  const description = String(item.description || '').trim();

  els.detailTitle.textContent = item.fullName || '未知仓库';

  els.detailDesc.textContent = description || '暂无描述';
  els.detailDesc.classList.toggle('is-empty', !description);

  els.detailMeta.replaceChildren();

  if (item.language) {
    const language = create('span', 'tag');
    const dot = create('span', 'lang-dot');
    dot.style.backgroundColor = languageColor(item.language);
    language.append(dot, document.createTextNode(item.language));
    els.detailMeta.append(language);
  }

  addDetailMeta(els.detailMeta, 'tag stars', `★ ${formatNumber(item.stars)}`);

  if (item.starsToday > 0) {
    addDetailMeta(els.detailMeta, 'today', `↑ ${formatNumber(item.starsToday)} 今日`);
  }

  addDetailMeta(els.detailMeta, 'tag', `Fork ${formatNumber(item.forks)}`);

  if (item.createdAt) {
    const createdDate = String(item.createdAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) {
      addDetailMeta(els.detailMeta, 'tag', `创建于 ${formatDate(createdDate)}`);
    }
  }

  if (item.sources?.includes('trending')) {
    addDetailMeta(els.detailMeta, 'source-badge', 'Trending');
  }
  if (item.isNew) addDetailMeta(els.detailMeta, 'source-badge', '新项目');
  if (item.sources?.includes('high-star')) {
    addDetailMeta(els.detailMeta, 'source-badge', '高星');
  }

  const topics = Array.isArray(item.topics) ? item.topics : [];
  for (const topic of topics) {
    addDetailMeta(els.detailMeta, 'tag topic', `#${topic}`);
  }

  els.detailGithub.href = safeGitHubUrl(item.url);

  if (description) {
    els.detailBaidu.href = baiduTranslateUrl(description);
    els.detailBaidu.removeAttribute('aria-disabled');
  } else {
    els.detailBaidu.href = '#';
    els.detailBaidu.setAttribute('aria-disabled', 'true');
  }

  if (els.detailOverlay.hidden) {
    lastDetailFocus = document.activeElement;
    els.detailOverlay.hidden = false;
    document.body.classList.add('modal-open');
    if (!history.state?.githubDailyDetail) {
      history.pushState(
        { ...(history.state || {}), githubDailyDetail: true },
        '',
        window.location.href,
      );
    }
    requestAnimationFrame(() => els.detailBack.focus({ preventScroll: true }));
  }

  loadReadme(item, state.readmeToken);
}

function showReadme(text, item) {
  state.readmeText = String(text || '');
  state.readmeLoaded = true;
  els.readmeSection.hidden = false;
  els.readmeStatus.textContent = item.readmeTruncated ? '内容已截断' : '';
  els.detailReadme.classList.toggle('is-empty', !state.readmeText);
  els.detailReadme.textContent = state.readmeText || '没有抓取到这个项目的 README。';
  updateTranslateButton();
}

function setTranslationNote(message, isError = false) {
  els.translationNote.textContent = message || '';
  els.translationNote.hidden = !message;
  els.translationNote.classList.toggle('is-error', Boolean(message) && isError);
}

function updateTranslateButton() {
  if (!state.detail || state.translating) return;

  if (state.translationMode === 'translated') {
    els.detailTranslate.textContent = '显示原文';
    els.detailTranslate.disabled = false;
    return;
  }

  const hasCached = Boolean(
    state.fullTranslations[fullTranslationKey(state.detail, state.readmeText)],
  );
  const hasContent = Boolean(
    String(state.detail.description || '').trim() || state.readmeText.trim(),
  );
  const waitingReadme = Boolean(state.detail.readmeFile) && !state.readmeLoaded;

  els.detailTranslate.textContent = hasCached ? '显示译文' : '翻译全文';
  els.detailTranslate.disabled = !hasContent || waitingReadme;
}

async function loadReadme(item, token) {
  state.readmeLoaded = false;
  state.readmeText = '';
  els.readmeSection.hidden = false;
  els.readmeStatus.textContent = '';
  els.detailReadme.classList.remove('is-empty');
  updateTranslateButton();

  if (!item.readmeFile) {
    showReadme('', item);
    return;
  }

  const cached = readmeCache.get(item.readmeFile);
  if (cached) {
    if (token === state.readmeToken) showReadme(cached, item);
    return;
  }

  els.readmeStatus.textContent = '加载中…';
  els.detailReadme.classList.add('is-empty');
  els.detailReadme.textContent = '正在加载 README…';

  try {
    const response = await fetch(
      `data/readmes/${encodeURIComponent(item.readmeFile)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`README HTTP ${response.status}`);

    const text = (await response.text()).trim();
    if (token !== state.readmeToken || state.detail !== item) return;

    readmeCache.set(item.readmeFile, text);
    if (readmeCache.size > 120) {
      readmeCache.delete(readmeCache.keys().next().value);
    }
    showReadme(text, item);
  } catch (error) {
    if (token !== state.readmeToken) return;
    console.error(error);
    state.readmeText = '';
    state.readmeLoaded = true;
    els.readmeStatus.textContent = '';
    els.detailReadme.classList.add('is-empty');
    els.detailReadme.textContent = 'README 加载失败，请稍后重新打开详情。';
    updateTranslateButton();
  }
}

async function requestTranslation(text, attempt = 1) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', 'en|zh-CN');

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);

    const payload = await response.json();
    if (Number(payload.responseStatus) !== 200) {
      throw new Error(payload.responseDetails || 'Translation request failed');
    }

    const translated = decodeHtmlEntities(
      String(payload.responseData?.translatedText || ''),
    ).trim();

    if (!translated) throw new Error('Empty translation');

    return {
      text: translated,
      quotaFinished: Boolean(payload.quotaFinished),
    };
  } catch (error) {
    if (attempt < 3) {
      await sleep(600 * attempt);
      return requestTranslation(text, attempt + 1);
    }
    throw error;
  }
}

function applyTranslationMode(mode) {
  const item = state.detail;
  if (!item) return;

  const originalDescription = String(item.description || '').trim();
  const originalReadme = String(state.readmeText || '').trim();

  if (mode === 'translated' && state.fullTranslation) {
    const description = String(state.fullTranslation.description || '').trim();
    const readme = String(state.fullTranslation.readme || '').trim();

    els.detailDesc.textContent = description || originalDescription || '暂无描述';
    els.detailDesc.classList.toggle('is-empty', !(description || originalDescription));
    els.detailReadme.textContent = readme || originalReadme || '没有抓取到这个项目的 README。';
    els.detailReadme.classList.toggle('is-empty', !(readme || originalReadme));
    els.readmeStatus.textContent = item.readmeTruncated ? '内容已截断 · 译文' : '译文';
    state.translationMode = 'translated';
    setTranslationNote('机器翻译由 MyMemory 提供，仅供参考。');
    els.detailTranslate.textContent = '显示原文';
    els.detailTranslate.disabled = false;
    return;
  }

  els.detailDesc.textContent = originalDescription || '暂无描述';
  els.detailDesc.classList.toggle('is-empty', !originalDescription);
  els.detailReadme.textContent = originalReadme || '没有抓取到这个项目的 README。';
  els.detailReadme.classList.toggle('is-empty', !originalReadme);
  els.readmeStatus.textContent = item.readmeTruncated ? '内容已截断' : '';
  state.translationMode = 'original';
  setTranslationNote('');
  updateTranslateButton();
}

async function translateFull() {
  const item = state.detail;
  if (!item) return;

  if (state.translationMode === 'translated') {
    applyTranslationMode('original');
    return;
  }

  const description = String(item.description || '').trim();
  const readmeText = String(state.readmeText || '').trim();
  const key = fullTranslationKey(item, readmeText);

  if (state.fullTranslations[key]) {
    state.fullTranslation = state.fullTranslations[key];
    applyTranslationMode('translated');
    return;
  }

  if (state.translating) return;
  if (!description && !readmeText) return;
  if (item.readmeFile && !state.readmeLoaded) return;

  const chunks = readmeText ? splitTranslationChunks(readmeText) : [];
  const descriptionNeedsTranslation = Boolean(description) && !isMostlyChinese(description);
  const translatableChunks = chunks.filter((chunk) => !isMostlyChinese(chunk)).length;
  const total = (descriptionNeedsTranslation ? 1 : 0) + translatableChunks;

  state.translating = true;
  const token = ++state.fullTranslationToken;
  setTranslationNote('');
  els.detailTranslate.disabled = true;
  els.detailTranslate.textContent = total ? `翻译中 0/${total}` : '翻译中…';
  if (readmeText) {
    els.readmeStatus.textContent = total ? `翻译中 0/${total}` : '翻译中…';
  }

  let done = 0;
  const updateProgress = () => {
    if (token !== state.fullTranslationToken || state.detail !== item) return;
    els.detailTranslate.textContent = `翻译中 ${done}/${total}`;
    if (readmeText) els.readmeStatus.textContent = `翻译中 ${done}/${total}`;
  };

  try {
    let translatedDescription = description;

    if (descriptionNeedsTranslation) {
      const descriptionKey = translationKey(item, description);
      const cachedDescription = state.translations[descriptionKey]?.text;

      if (cachedDescription) {
        translatedDescription = cachedDescription;
      } else {
        const result = await requestTranslation(description);
        if (token !== state.fullTranslationToken || state.detail !== item) return;
        translatedDescription = result.text;
        state.translations[descriptionKey] = {
          text: translatedDescription,
          at: new Date().toISOString(),
        };
        persistTranslations();
      }

      done += 1;
      updateProgress();
    }

    const translatedChunks = [];
    for (const chunk of chunks) {
      if (token !== state.fullTranslationToken || state.detail !== item) return;

      if (isMostlyChinese(chunk)) {
        translatedChunks.push(chunk);
        continue;
      }

      const result = await requestTranslation(chunk);
      if (token !== state.fullTranslationToken || state.detail !== item) return;
      translatedChunks.push(result.text);
      done += 1;
      updateProgress();
      await sleep(120);
    }

    const translation = {
      description: translatedDescription,
      readme: readmeText ? translatedChunks.join('\n\n') : '',
      at: new Date().toISOString(),
    };

    state.fullTranslations[key] = translation;
    persistFullTranslations();
    state.fullTranslation = translation;
    state.translating = false;
    applyTranslationMode('translated');
  } catch (error) {
    if (token !== state.fullTranslationToken) return;
    console.error(error);
    state.translating = false;
    applyTranslationMode('original');
    els.detailTranslate.textContent = '重试翻译';
    els.detailTranslate.disabled = false;
    els.readmeStatus.textContent = item.readmeTruncated ? '内容已截断' : '';
    setTranslationNote('翻译失败：免费翻译服务暂时不可用，请稍后重试。', true);
  }
}

function requestCloseDetail() {
  if (els.detailOverlay.hidden) return;

  if (history.state?.githubDailyDetail) {
    history.back();
    return;
  }

  closeDetail();
}

function closeDetail() {
  if (els.detailOverlay.hidden) return;

  els.detailOverlay.hidden = true;
  document.body.classList.remove('modal-open');
  state.detail = null;
  state.fullTranslation = null;
  state.fullTranslationToken += 1;
  state.translationMode = 'original';
  state.translating = false;
  state.readmeToken += 1;
  state.readmeText = '';
  state.readmeLoaded = false;

  if (lastDetailFocus && typeof lastDetailFocus.focus === 'function') {
    lastDetailFocus.focus({ preventScroll: true });
  }
  lastDetailFocus = null;
}

function render() {
  updateDateNav();

  if (state.tab !== 'fav') {
    if (state.status === 'loading') {
      renderMeta([]);
      renderLoading();
      return;
    }

    if (state.status === 'error') {
      els.meta.textContent = state.date ? formatDate(state.date) : '';
      renderMessage('数据加载失败', '请稍后刷新页面重试。');
      return;
    }

    if (!state.data) {
      els.meta.textContent = state.dates.length ? '' : '暂无数据';
      renderMessage(
        '还没有榜单数据',
        '等待 GitHub Actions 第一次运行，或手动触发一次工作流。',
      );
      return;
    }
  }

  const items = getVisibleItems();
  renderMeta(items);
  els.list.replaceChildren();

  if (!items.length) {
    renderEmptyForCurrentView();
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => fragment.append(createCard(item, index)));
  els.list.append(fragment);
}

async function loadDate(date) {
  const token = ++loadToken;
  state.date = date;
  state.status = 'loading';
  state.language = '';
  els.language.value = '';
  els.dateSelect.value = date;

  render();

  try {
    const data = await fetchJson(`data/${encodeURIComponent(date)}.json`);
    if (token !== loadToken) return;

    state.data = data;
    state.items = Array.isArray(data.items) ? data.items : [];
    state.status = 'ready';
    populateLanguages();
    document.title = `${formatDate(data.date)} · GitHub 日报`;

    const url = new URL(window.location.href);
    url.searchParams.set('date', data.date);
    window.history.replaceState(null, '', url.toString());

    render();
  } catch (error) {
    if (token !== loadToken) return;
    console.error(error);
    state.data = null;
    state.items = [];
    state.status = 'error';
    render();
  }
}

function moveDate(offset) {
  const index = state.dates.findIndex((entry) => entry.date === state.date);
  const target = state.dates[index + offset];
  if (target) loadDate(target.date);
}

function setTab(tab) {
  if (!['all', 'new', 'high', 'fav'].includes(tab)) return;
  state.tab = tab;

  for (const button of els.tabs) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }

  populateLanguages();
  render();
}

let toastTimer = null;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('is-visible'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => {
      els.toast.hidden = true;
    }, 200);
  }, 2200);
}

async function sharePage() {
  const url = new URL(window.location.href);
  url.searchParams.delete('v');
  if (state.detail) url.searchParams.set('repo', state.detail.fullName);

  const data = {
    title: 'GitHub 日报',
    text: '每天看 GitHub 热门仓库，支持中文翻译',
    url: url.toString(),
  };

  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('链接已复制，可以发给朋友');
  } catch {
    window.prompt('复制链接发给朋友', url.toString());
  }
}

function bindEvents() {
  els.prevDate.addEventListener('click', () => moveDate(1));
  els.nextDate.addEventListener('click', () => moveDate(-1));

  els.dateSelect.addEventListener('change', () => {
    if (els.dateSelect.value) loadDate(els.dateSelect.value);
  });

  for (const button of els.tabs) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    render();
  });

  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.search.value = '';
      state.query = '';
      render();
    }
  });

  els.language.addEventListener('change', () => {
    state.language = els.language.value;
    render();
  });

  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    render();
  });

  els.detailClose.addEventListener('click', requestCloseDetail);
  els.detailBack.addEventListener('click', requestCloseDetail);
  els.detailTranslate.addEventListener('click', translateFull);
  els.sharePage.addEventListener('click', sharePage);

  els.detailOverlay.addEventListener('click', (event) => {
    if (event.target === els.detailOverlay) requestCloseDetail();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.detailOverlay.hidden) {
      event.preventDefault();
      requestCloseDetail();
    }
  });

  window.addEventListener('popstate', () => {
    if (!els.detailOverlay.hidden) closeDetail();
  });
}

function openRepoFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get('repo');
  if (!repo) return;

  const item = state.items.find((candidate) => keyOf(candidate) === repo.toLowerCase());
  if (!item) return;

  const url = new URL(window.location.href);
  url.searchParams.delete('repo');
  window.history.replaceState(history.state, '', url.toString());

  openDetail(item);
}

async function init() {
  bindEvents();
  updateFavCount();

  if (history.state?.githubDailyDetail) {
    history.replaceState({ ...history.state, githubDailyDetail: false }, '', window.location.href);
  }

  try {
    const index = await fetchJson('data/index.json');
    state.dates = normalizeDates(index);
  } catch (error) {
    console.error(error);
    state.dates = [];
    state.status = 'error';
    populateDateSelect();
    render();
    return;
  }

  if (!state.dates.length) {
    state.status = 'empty';
    populateDateSelect();
    render();
    return;
  }

  const requested = new URLSearchParams(window.location.search).get('date');
  const initial = state.dates.some((entry) => entry.date === requested)
    ? requested
    : state.dates[0].date;

  populateDateSelect();
  await loadDate(initial);
  if (state.status === 'ready') openRepoFromQuery();
}

init();
