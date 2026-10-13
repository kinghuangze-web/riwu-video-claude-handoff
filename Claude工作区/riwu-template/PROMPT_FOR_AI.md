# 给其他 AI 的开工提示词（直接复制）

> 用法：把整个 `riwu-template` 文件夹和新一期的图卡交给 AI（GPT / Gemini / Claude 等能看图、能跑命令的模型），然后发下面这段。

---

你要用这个仓库做一期「日物图鉴」多语言物件短视频。

1. 先完整读 `AI_GUIDE.md`，再读 `episodes/M006/episode.json` 和 `samples/M006_v0.4_keyframes.jpg`（以及 `samples/M006_v0.4.mp4`），理解标准答案长什么样。
2. 新图卡在 `<这里写路径>`。照 `episodes/_TEMPLATE/README.md` 新建 `episodes/<编号>/`。
3. 你**只能**写 `episodes/<编号>/episode.json`。不准改 `src/`、`scripts/`、`template/`，不准修改或重新生成图卡，不准重打卡上的文字。
4. 先跑 `python3 scripts/grid.py episodes/<编号>`，从 `build/<编号>/grid/` 的网格图上读坐标；逐张看图卡，按 `AI_GUIDE.md` 的规则画框（0–1000 比例坐标）。`subject` 框被讲的那个小东西本身。照片框要避开页眉/logo/页码；例句只框一句原文 + 它的翻译；每种语言 1 块重点（日语最多 2 块、中文 0 块），挑不同角度，每块只留 1–2 句关键的话。
5. `word` / `reading` 照卡一字不差抄写；`parts` 把名字拆段，`t` 拼起来必须等于 `word`，`m` 和 `link` 只用卡上写着的意思，同一意思在各语言用同一个 `link`。`meaning`（字面意思，≤12 字）和 `insight`（跨语言发现，≤24 字）只能根据卡片上写着的内容归纳；归纳不出来就不写。`bridge` 默认「中」（最先、很短），`anchor` 默认「日」（主角）；`insight_langs` 填 insight 涉及的语言简称，`insight_links` 填要高亮的 link 代号。
6. 跑 `python3 scripts/prepare.py episodes/<编号>`，打开 `build/<编号>/qc/lifts.png` 自己检查：切字、混栏、越过红线都要改框重跑，直到没有 ✖ 和 ⚠（包括 ⚠ 阅读时间：框少一点）。
7. 跑 `./render.sh episodes/<编号>`，确认 `build/<编号>/qc/report.md` 结论是 ✓，再看 `qc/keyframes.jpg` 和 `qc/contact_2fps.jpg`，按 `docs/人工验收清单.md` 自查。
8. 交付：`out/<编号>.mp4`、你的 `episode.json`、一段说明（每种语言选了哪块重点、为什么；`meaning`/`insight` 的卡片依据；卡片上发现的可疑之处）。

---
