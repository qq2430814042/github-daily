# GitHub 日报

每天北京时间 08:05 抓取前一天 GitHub 上新增的热门仓库、Trending 榜单和高星活跃项目，生成一个适合手机浏览的榜单页面，并可推送到微信。

- 每日榜单：新项目、Trending、高星项目合并去重
- 手机优先：支持搜索、语言筛选、按 Star 数/涨星数排序、收藏
- 项目详情：点击卡片或仓库名查看完整描述、语言、Star、Fork、创建时间和标签
- 一键翻译：详情内可将英文描述翻译成中文，不依赖 GitHub，失败时可跳转百度翻译
- 历史归档：每天一个 JSON 文件，日期可回看
- 微信推送：通过 Server酱 或 PushPlus 每天推送 Top 8 和完整榜单链接
- 零成本：GitHub Actions + GitHub Pages，无需服务器

## 工作原理

1. GitHub Actions 每天定时运行 `scripts/fetch.mjs`。
2. 脚本从三个来源抓取数据：
   - `github.com/trending?since=daily`：当天的 Trending 仓库和今日涨星数
   - GitHub Search API：前一天新建且已经获得 Star 的仓库
   - GitHub Search API：总 Star 超过 1000、前一天有推送的仓库
3. 合并、去重、排序后写入 `docs/data/YYYY-MM-DD.json`，并更新 `docs/data/index.json`。
4. 数据自动提交回仓库，GitHub Pages 部署 `docs` 目录。
5. 部署完成后运行 `scripts/push.mjs`，通过 Server酱 或 PushPlus 推送到微信。

默认抓取日期是北京时间的前一天，所以早上看到的是完整的前一天榜单。

## 快速部署

### 1. 创建仓库并上传代码

在 GitHub 新建一个**公开**仓库，例如 `github-daily`，然后把当前目录上传上去。

```powershell
git init
git add .
git commit -m "init github daily"
git branch -M main
git remote add origin https://github.com/<你的用户名>/github-daily.git
git push -u origin main
```

公开仓库才能免费使用 GitHub Pages。私有仓库需要 GitHub Pro。

### 2. 允许 Actions 写入仓库

仓库页面进入 `Settings` → `Actions` → `General` → `Workflow permissions`，选择 `Read and write permissions` 并保存。

工作流需要这个权限把每日 JSON 自动提交回仓库。

### 3. 开启 GitHub Pages

进入 `Settings` → `Pages` → `Build and deployment`：

- `Source` 选择 `GitHub Actions`
- 不需要选择分支

部署成功后页面地址是：

```text
https://<你的用户名>.github.io/<仓库名>/
```

### 4. 配置微信推送

推荐使用 [Server酱](https://sct.ftqq.com)，免费且不需要实名：

1. 打开 Server酱，微信扫码登录并关注它的微信服务号。
2. 点顶部「Key&API」，复制以 `SCT` 开头的 SendKey。
3. 回到 GitHub 仓库，进入 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`。
4. 名称填 `SERVERCHAN_SENDKEY`，值填刚才复制的 SendKey。

Server酱免费版每天最多 5 条，微信通知只显示标题，不展示正文，也没有可点击的内容链接；完整内容请打开网页查看。需要微信里直接点开正文，可以改用已实名的 PushPlus（需要付费/会员）或其他推送渠道。

PushPlus 也可以使用，但 2024 年起要求实名认证（需要身份证并付费/开通会员）后才能调用发送接口。如果账号已经实名，可以添加 Secret `PUSHPLUS_TOKEN`。

两个都配置时会同时发送；不配置任何推送渠道时，抓取和页面仍会正常运行，只跳过推送。

### 5. 运行一次

进入仓库的 `Actions` → `Daily GitHub Digest` → `Run workflow`。

手动运行时可以填写 `backfill`：

- `1`：只抓前一天
- `7`：补抓最近 7 天，方便第一次把历史填满

第一次运行会同时部署页面。之后每天 00:05 UTC（北京时间 08:05）自动运行。

GitHub Actions 的定时任务可能延迟几分钟，属于正常现象。

### 6. 添加到手机主屏幕

打开 Pages 地址：

- iPhone Safari：分享 → 添加到主屏幕
- Android Chrome：菜单 → 添加到主屏幕

之后可以像 App 一样直接打开，收藏会保存在手机浏览器本地。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm install

# 抓取前一天数据
npm run fetch

# 补抓最近 7 天
node scripts/fetch.mjs --backfill=7

# 本地预览
python -m http.server 4173 --directory docs
```

打开 `http://127.0.0.1:4173/`。

本地推送需要先设置环境变量：

```powershell
$env:SERVERCHAN_SENDKEY="你的 Server酱 SendKey"
$env:PAGE_URL="https://<你的用户名>.github.io/<仓库名>/"
npm run push
```

可选环境变量：

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 本地抓取时提高 API 限流额度 | 否 |
| `SERVERCHAN_SENDKEY` | Server酱 微信推送 | 二选一 |
| `PUSHPLUS_TOKEN` | PushPlus 微信推送（需实名） | 二选一 |
| `PAGE_URL` | 推送消息里的榜单地址，自定义域名时使用 | 否 |

在 GitHub Actions 中，`PAGE_URL` 可以配置成仓库 Variable；不配置时会自动推导 Pages 地址。

## 数据与排序

每日榜单最多 60 个仓库，大致配额：

- Trending：最多 25 个
- 高星项目：最多 12 个
- 新项目：补足剩余名额

排序优先看今日涨星数，其次给新项目加权，最后参考总 Star 数。页面上的「高星」标签指总 Star 超过 1000 的仓库。

每日 JSON 字段包括：

- `fullName`、`url`、`description`
- `language`、`stars`、`forks`、`starsToday`
- `topics`、`createdAt`、`updatedAt`
- `sources`：`trending` / `new` / `high-star`
- `isNew`：是否为前一天新建的仓库

## 可调整的地方

| 想改什么 | 修改位置 |
| --- | --- |
| 每天抓取数量 | `scripts/fetch.mjs` 里的 `CAP` |
| 高星门槛 | `docs/app.js` 里的 `HIGH_STAR` |
| 各类目配额 | `scripts/fetch.mjs` 里的 `selectItems` |
| 定时时间 | `.github/workflows/daily.yml` 里的 cron |
| 推送条数 | `scripts/push.mjs` 里的 `TOP_COUNT` |
| 页面文案和样式 | `docs/index.html`、`docs/style.css` |

## 常见问题

**页面 404 或没有部署**

确认 `Settings` → `Pages` 的 Source 是 `GitHub Actions`，并检查 Actions 里的 `deploy` 任务是否成功。

**抓取任务失败**

先看 Actions 日志。GitHub Trending 没有官方 API，页面结构变化时可能解析失败；脚本会记录警告并继续用 Search API 兜底。Search API 触发限流时，工作流里使用的是 GitHub 自动提供的 token，通常不会遇到。

**微信推送点进去看不到内容**

这是 Server酱免费版的限制：微信通知只有标题，不带正文和详情链接。完整榜单请从手机主屏幕打开网页。如果一定要在微信消息里看可点击的正文，需要换用已实名的 PushPlus 或其他推送渠道。

网页里的详情和翻译不需要访问 GitHub，只有「打开 GitHub」按钮需要 GitHub 可用。GitHub 打不开时，点仓库名或「详情 / 翻译」仍然可以看描述并使用翻译。

**翻译失败**

翻译使用 MyMemory 的免费接口，网络受限、额度用尽或描述已经是中文时可能失败。可以点详情里的「百度翻译」打开外部翻译页；重新打开相同项目会优先使用本地缓存。

**收不到微信推送**

- 确认 Secret 名称是 `SERVERCHAN_SENDKEY` 或 `PUSHPLUS_TOKEN`
- 检查 Actions 的 `notify` 任务日志，正常情况下会看到 `ServerChan: sent`
- Server酱免费版每天最多 5 条，通知卡片主要显示标题
- PushPlus 返回“账户未通过实名认证”时，需要先完成实名认证，或改用 Server酱
- PushPlus 的接口返回 `code: 200` 只代表服务端收到请求，实际发送可能稍有延迟

**某一天没有新项目**

GitHub Search 只索引达到一定 Star 的仓库，当天没有符合条件的新项目时，该分类会为空。

**历史日期太少**

在 Actions 里手动运行工作流，把 `backfill` 填成 `7` 或 `30`，会补抓最近 N 天。

## 目录结构

```text
github-daily/
├─ .github/workflows/daily.yml   # 每日抓取、部署、推送
├─ scripts/
│  ├─ fetch.mjs                  # 抓取、合并、生成 JSON
│  └─ push.mjs                   # 微信推送
├─ docs/
│  ├─ index.html                 # 手机榜单页面
│  ├─ style.css
│  ├─ app.js
│  ├─ favicon.svg
│  ├─ apple-touch-icon.png
│  ├─ icon-192.png
│  ├─ icon-512.png
│  ├─ manifest.webmanifest
│  └─ data/                      # 每日数据和索引
├─ package.json
└─ package-lock.json
```

本项目面向个人使用，默认所有数据公开在仓库和 GitHub Pages 上。
