# Claude独立工作区

当前成果：**[riwu-template](riwu-template/README.md)**，日物图鉴多语言物件竖版短视频模板（v0.4.1）。

- 输入：一组图卡 + 一份 `episode.json`（只填区域框和名字，不改写卡片内容）
- 输出：1080×1920 / 30fps 竖版 MP4（约 43–46 秒，无配音，代码合成配乐）+ 自检报告
- 一条命令出片：`cd riwu-template && ./render.sh episodes/M009`（环境见 [SETUP.md](riwu-template/SETUP.md)）
- 已做好的期：M.004 帽内吸汗带、M.005 杯盖排气孔、M.006 咖啡杯套、M.009 圆珠笔防滑握套；M.003 指甲锉只有卡片，尚未配置
- 让其他 AI 接手做新的一期：[PROMPT_FOR_AI.md](riwu-template/PROMPT_FOR_AI.md) + [AI_GUIDE.md](riwu-template/AI_GUIDE.md)
- 样例成片：见仓库 Releases（视频不放进代码里）
- 版本变化：[CHANGELOG.md](riwu-template/CHANGELOG.md)；人工验收：[docs/人工验收清单.md](riwu-template/docs/人工验收清单.md)

真实执行过的检查：每期 `qc/report.md`（编码、帧数、音画等长、空帧、响度、字高等）与关键帧目测。未验证：配乐实际听感、真机播放、各语言内容的正确性（以卡片为准）。
