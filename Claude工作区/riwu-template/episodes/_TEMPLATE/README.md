# 新建一期

1. 复制整个文件夹：`cp -r episodes/_TEMPLATE episodes/M007`
2. 图卡放进 `episodes/M007/cards/`（01 封面、02… 各语言、最后一张结尾），文件名和 `episode.json` 里的 `file` 一致。
3. 改 `episode.json`：这里的坐标只是占位（照 M006 的版式填的），**每一个框都要按新图卡重画**。空字符串的 `meaning` / `insight` 不会显示，卡上读不出来就留空。
4. 照 `AI_GUIDE.md` 跑 `prepare.py` → 看 `qc/lifts.png` → `./render.sh`。
