# 环境安装（第一次用这台电脑时做一次）

## 需要的东西

| 组件 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18（测试用 24） | 跑 Remotion 渲染 |
| Python | ≥ 3.10（测试用 3.13） | `prepare.py` / `audio.py` / `qc.py` |
| numpy、Pillow | 见 `requirements.txt` | 切图、合成音频 |
| FFmpeg / ffprobe | ≥ 6（测试用 7.0） | 转码、响度、自检 |
| 字体 Noto Serif CJK SC（思源宋体） | 任意 | 模板里所有新加的字（标签、复盘、结尾）。没装会退回系统宋体，风格会变 |
| Chromium / Chrome | 可选 | 不指定时 Remotion 会自动下载 Headless Shell |

## 安装步骤

```bash
cd riwu-template
npm install                      # 装 remotion / react（版本锁在 package.json）
pip3 install -r requirements.txt
# 字体：
#   macOS:   brew install --cask font-noto-serif-cjk-sc
#   Ubuntu:  sudo apt install fonts-noto-cjk
#   Windows: 到 Google Fonts 下载 Noto Serif SC 并安装
fc-list | grep -i "Noto Serif CJK SC"   # 能看到就行（macOS/Windows 可跳过这句）
```

可选：用自己的浏览器 `export CHROMIUM_PATH=/path/to/chromium`。

## 跑一遍样例确认环境没问题

```bash
./render.sh episodes/M006
```

成功标志：最后一行是 `结论：✓ 自动检查通过`，生成 `out/M006.mp4`，和 `samples/M006_v0.2.mp4` 看起来一致。

耗时参考：2 核 CPU 的云服务器约 20 分钟；普通笔记本（8 核）约 5–8 分钟。`render.sh` 里 `--concurrency=2` 可以按 CPU 核数调大。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `typescript.sys is undefined` 之类的打包报错 | TypeScript 7 与 Remotion 打包器不兼容，`remotion.config.js` 已经绕过；别删那段 |
| `Cannot find package '@remotion/renderer'`（跑 `stills.mjs` 时） | 没在项目目录里 `npm install` |
| 画面里的中文字体不对 | 没装 Noto Serif CJK SC |
| 渲染时浏览器报 GL 错误 | Mac/Windows 上把 `remotion.config.js` 里的 `setChromiumOpenGlRenderer('swangle')` 删掉 |
| 成片在某些平台颜色发灰 | 已在 `render.sh` 里统一转成 TV 色域 bt709，别跳过最后那步 ffmpeg |
| 想快速看效果不想等整片 | 见 `README.md` 的「调试：只渲几帧」 |
