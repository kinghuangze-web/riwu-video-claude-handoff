# 日物图鉴 · 多语言物件讲解视频模板 v0.4

输入：一组图卡（封面提问 + 每种语言一张 + 结尾互动）+ 一份 `episode.json`（只有区域框，不转写文字）
输出：1080×1920 / 30fps / H.264 + AAC 的竖版 MP4（约 35–50 秒）+ 自检报告

```
./render.sh episodes/M006            # 出片 + 自检
./render.sh episodes/M006 --bgm x.mp3  # 用自己的背景音乐替换合成配乐
```

## 片子结构（固定，按节拍 100BPM 卡点）

| 段 | 画面 | 声音 |
|---|---|---|
| 开场 4.8s | 第 0 帧就有问题句；物件纹理特写＋问号 → 拉开看全貌 →「先猜一下」＋右侧 3·2·1 圆环倒数（不挡物件） | 起拍、甩镜、倒数滴答 |
| 中文（过渡） | 「你熟悉的叫法」：先给观众一个已知的名字，2.4 秒 | 落点 |
| 日语（主角） | 「重点记」：大字名字＋读音＋拆段意思单独停留 → 1–2 块重点（名字一直留在屏上）→「还记得它叫什么吗？」模糊名字后揭晓 | 揭晓铃、弹出 |
| 其他语言 | 名字＋读音＋拆段 →「又见面了」：和前面语言同一意思的那段连起来 → 1 块重点 | 落点、弹出 |
| 复盘 | 「同一个东西 · N 种叫法」，各语言名称＋字面意思依次进来 → 一句跨语言发现（高亮相关行） | 逐个弹出、揭晓铃 |
| 结尾 | 物件照片压暗＋名字模糊 →「不回看，你记住了吗？」→ 评论框打字 → 名字逐个揭晓 | 落点、打字声、收尾和弦 |

场景之间是**重叠推镜**（新场景推入、旧场景同时推出），没有空帧。

## 关键设计

- **原生 9:16。**不再把 3:4 卡片整张塞进竖屏；照片全出血铺上半屏，文字面板直接落在纸面上；顶栏、右侧按钮列、底部文案区都留空（见 `AI_GUIDE.md` §5）。
- **名字原生排版，讲解只用原图像素。**名字/读音/拆段意思由 `episode.json` 照卡片原样填写、用 Noto Serif CJK 排版（必须和卡上一字不差）；讲解文字区域从原卡上切出来放大，太宽的行按字间/词间空隙自动重排成几行（`scripts/prepare.py` 的 `layout_lift`），切片预先用 Lanczos 放大并锐化，面板底色取自卡片本身，不重新打字，也就不会抄错。
- **AI 只填框。**画风、动效、时长、配乐都在代码里，换模型不换风格。见 `AI_GUIDE.md`。
- **时长自动算。**按每块文字量估阅读时间，限制在上下限内并卡到整拍。
- **配乐用代码合成**（`scripts/audio.py`），无版权问题，长度与画面逐帧相等。
- **只检查最终 MP4。**`scripts/qc.py`：原图 sha256、编码、帧数、音画等长、整片解码、空画面、片尾、静音、响度、正文字高，并输出 2fps 拼图和关键帧。

## 先读哪个

| 你是谁 | 读 |
|---|---|
| 第一次装环境 | `SETUP.md` |
| 要做新的一期（人或 AI） | `AI_GUIDE.md` → `episodes/_TEMPLATE/README.md`；交给其他 AI 时直接发 `PROMPT_FOR_AI.md` |
| 要验收成片 | `docs/人工验收清单.md` |
| 要改系列风格/节奏 | `docs/参数说明.md`、`docs/画面结构与时间线.md` |
| 想知道改过什么 | `CHANGELOG.md` |

## 目录

```
README.md / SETUP.md / AI_GUIDE.md / PROMPT_FOR_AI.md / CHANGELOG.md
docs/
  参数说明.md               style.json 每个参数、音效事件表
  画面结构与时间线.md        分区、各场景每一步
  人工验收清单.md
  方法论_用户原文转写.md      系列方法论（原 docx 转写，供参考）
template/style.json        全系列视觉与节奏参数（配色、字号目标、停留上下限、固定文案）
episodes/M006/             标准样例：cards/ 原图 + episode.json
episodes/M005/ M004/       另两种版式的样例（页眉压照片 + 小主体 / 标题居中 + 韩语）
episodes/_TEMPLATE/        新建一期时复制它
samples/                   M006 / M005 / M004 成片 + 拼图 + 自检报告，用来对照
scripts/prepare.py         框 → 吸附文字 → 重排 → 预渲切片 → 时间线 build/<期>/plan.json + qc/lifts.png
scripts/audio.py           plan → 配乐与音效 audio.wav
scripts/qc.py              成片自检 → build/<期>/qc/report.md、keyframes.jpg、contact_2fps.jpg
scripts/stills.mjs         调试用：批量渲静帧
scripts/grid.py            给卡片叠 0–1000 坐标网格（画框时读坐标用）
src/                       Remotion 渲染器（只读 plan.json，无任何每期内容）
  Film.tsx                 HUD、开场、讲解页、复盘、结尾、场景推镜
  kit.tsx                  照片铺满、面板、荧光笔、放射线、标签等通用部件
render.sh                  一条命令出片 + 自检
```

生成物（可随时删）：`build/<期>/`（plan、切片、音频、自检）、`build/bundle/`、`out/`。

## 调试：只渲几帧

```bash
python3 scripts/prepare.py episodes/M006 && python3 scripts/audio.py build/M006
rm -rf build/bundle && npx remotion bundle src/index.ts --out-dir build/bundle --public-dir=build/M006/public
cp -r build/M006/public/* build/bundle/public/
node scripts/stills.mjs build/M006/plan.json build/M006/stills 0,200,500,1100   # 输出 jpg
```

## 改了模板（scripts/ src/ template/）之后怎么回归

不要每次把所有期都重出一遍（一期完整渲染约 20–30 分钟）：
1. 所有样例期只跑 `python3 scripts/prepare.py episodes/<期>`：✖/⚠ 数量不能比改之前多，`qc/lifts.png` 逐张看一眼。
2. 挑**一期**和改动最相关的，渲几帧静帧（上面的「只渲几帧」）。
3. 只对这一期跑完整 `./render.sh`，看 `qc/report.md` 和 `qc/keyframes.jpg`。

也可以 `npx remotion studio src/index.ts` 在浏览器里拖时间轴（需要在右侧 Props 里粘贴 plan.json 内容）。

## 已知限制

- 讲解卡顶部压着页眉时，照片只能用页眉以下部分，会放大约 2 倍，比开场照片略软。
- 配乐和音效是代码合成的，作者没有实际试听过；建议换成自己的 BGM（`--bgm`）。
- 平台安全区按抖音/小红书常见布局估算，没有在每款手机上实测。
- 不校对语言内容，以卡片为准。
- 日文假名重排时可能在词中间换行（如「ファンデーショ／ン」）。
- 卡片照片上自带的装饰（虚线圈、放射短线）会跟着照片一起放大。
- 卡上没写意思的名字（如 M004「スベリ」）不拆字，回忆步没有提示。

## 借鉴与许可

节奏语法（停住 → 快推 → 停住）、「真实素材当主画面」、渲染可复现、拼图自检这几条思路参考了 [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion)（MIT），没有复制它的代码。Remotion 对个人和 3 人以内的公司免费，更大的团队需要购买商用授权。
