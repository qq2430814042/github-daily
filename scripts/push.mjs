import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'docs', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const TOP_COUNT = 8;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN').format(number);
}

function formatDateParts(isoDate) {
  const [year, month, day] = String(isoDate).split('-');
  return {
    year,
    month: Number(month),
    day: Number(day),
    label: `${Number(month)}月${Number(day)}日`,
  };
}

function trimText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function resolvePageUrl() {
  const configured = String(process.env.PAGE_URL || '').trim();
  if (configured) {
    return configured.endsWith('/') ? configured : `${configured}/`;
  }

  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) return '';

  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }
  return `https://${owner}.github.io/${repo}/`;
}

function itemStats(item) {
  const parts = [`★ ${formatNumber(item.stars)}`];
  if (item.starsToday > 0) parts.push(`↑ ${formatNumber(item.starsToday)} 今日`);
  if (item.language) parts.push(item.language);
  return parts.join(' · ');
}

function buildHtml(data, pageUrl) {
  const top = data.items.slice(0, TOP_COUNT);
  const rows = top
    .map((item) => {
      const description = trimText(item.description, 110);
      return [
        '<li style="margin:0 0 14px;">',
        `<a href="${escapeHtml(item.url)}" style="color:#0969da;font-weight:600;text-decoration:none;">${escapeHtml(item.fullName)}</a>`,
        '<br>',
        `<span style="color:#57606a;font-size:12px;">${escapeHtml(itemStats(item))}</span>`,
        description
          ? `<br><span style="color:#57606a;font-size:13px;">${escapeHtml(description)}</span>`
          : '',
        '</li>',
      ].join('');
    })
    .join('');

  return [
    '<div style="font-size:15px;line-height:1.65;color:#24292f;">',
    `<p>收录 <strong>${data.count}</strong> 个仓库，其中 <strong>${data.newCount}</strong> 个新项目。</p>`,
    `<ol style="padding-left:20px;margin:12px 0;">${rows}</ol>`,
    pageUrl
      ? `<p><a href="${escapeHtml(pageUrl)}" style="color:#0969da;font-weight:600;text-decoration:none;">查看完整榜单 →</a></p>`
      : '',
    '</div>',
  ].join('');
}

function buildMarkdown(data, pageUrl) {
  const top = data.items.slice(0, TOP_COUNT);
  const rows = top
    .map((item, index) => {
      const description = trimText(item.description, 110);
      const lines = [
        `${index + 1}. [${escapeMarkdown(item.fullName)}](${item.url})`,
        `   ${escapeMarkdown(itemStats(item))}`,
      ];
      if (description) lines.push(`   ${escapeMarkdown(description)}`);
      return lines.join('\n');
    })
    .join('\n');

  return [
    `收录 **${data.count}** 个仓库，其中 **${data.newCount}** 个新项目。`,
    '',
    rows,
    '',
    pageUrl ? `[查看完整榜单](${pageUrl})` : '',
  ].join('\n');
}

async function pushPlus(token, title, html) {
  const response = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      title,
      content: html,
      template: 'html',
      channel: 'wechat',
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || Number(result.code) !== 200) {
    throw new Error(
      `PushPlus failed (HTTP ${response.status}): ${result.msg || 'unknown error'}`,
    );
  }
}

async function serverChan(sendKey, title, markdown) {
  const endpoint = `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp: markdown }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || Number(result.code) !== 0) {
    throw new Error(
      `ServerChan failed (HTTP ${response.status}): ${result.message || 'unknown error'}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = await readJson(INDEX_FILE, { dates: [] });
  const dates = (index.dates || [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.date))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  const date = typeof args.date === 'string' ? args.date : dates[0];
  if (!date) {
    console.log('No daily data available, skipping push.');
    return;
  }

  const data = await readJson(path.join(DATA_DIR, `${date}.json`), null);
  if (!data || !Array.isArray(data.items) || !data.items.length) {
    console.log(`No data for ${date}, skipping push.`);
    return;
  }

  const dateParts = formatDateParts(data.date);
  const title = `GitHub 日报 · ${dateParts.label}`;
  const pageUrl = resolvePageUrl();
  const html = buildHtml(data, pageUrl);
  const markdown = buildMarkdown(data, pageUrl);

  if (args['dry-run']) {
    console.log(`Date: ${data.date}`);
    console.log(`Title: ${title}`);
    console.log(`Page URL: ${pageUrl || '(not configured)'}`);
    console.log(`Items: ${data.count}, pushing top ${Math.min(TOP_COUNT, data.items.length)}`);
    console.log('\n--- HTML ---\n');
    console.log(html);
    console.log('\n--- Markdown ---\n');
    console.log(markdown);
    return;
  }

  const pushplusToken = String(process.env.PUSHPLUS_TOKEN || '').trim();
  const sendKey = String(process.env.SERVERCHAN_SENDKEY || '').trim();

  if (!pushplusToken && !sendKey) {
    console.log('No PUSHPLUS_TOKEN or SERVERCHAN_SENDKEY configured, skipping push.');
    return;
  }

  let sent = 0;
  const errors = [];

  if (pushplusToken) {
    try {
      await pushPlus(pushplusToken, title, html);
      sent += 1;
      console.log('PushPlus: sent');
    } catch (error) {
      errors.push(error.message);
      console.warn(error.message);
    }
  }

  if (sendKey) {
    try {
      await serverChan(sendKey, title, markdown);
      sent += 1;
      console.log('ServerChan: sent');
    } catch (error) {
      errors.push(error.message);
      console.warn(error.message);
    }
  }

  if (!sent) {
    throw new Error(`All push channels failed:\n${errors.join('\n')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
