// 自动版面检查（看不了图时用）：node scripts/geom.mjs <plan.json> <outdir> f1,f2,...  → outdir/geom.json + 静帧 png
import {renderStill, selectComposition, openBrowser} from '@remotion/renderer';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const [planPath, outDir, frames] = process.argv.slice(2);
const props = {...JSON.parse(fs.readFileSync(planPath, 'utf8')), debug: true};
const serveUrl = fileURLToPath(new URL('../build/bundle', import.meta.url));
fs.mkdirSync(outDir, {recursive: true});
const browser = await openBrowser('chrome', {browserExecutable: process.env.CHROMIUM_PATH || null, chromiumOptions: {gl: 'swangle'}});
const composition = await selectComposition({serveUrl, id: 'Film', inputProps: props, puppeteerInstance: browser});
const res = {};
for (const f of frames.split(',').map(Number)) {
  let last = null;
  await renderStill({serveUrl, composition, frame: f, output: `${outDir}/f${String(f).padStart(5, '0')}.png`, imageFormat: 'png', inputProps: props, puppeteerInstance: browser,
    onBrowserLog: (l) => { if (l.text.startsWith('GEOM')) last = JSON.parse(l.text.slice(4)); }});
  res[f] = last ? last.boxes : null;
}
fs.writeFileSync(`${outDir}/geom.json`, JSON.stringify(res));
await browser.close({silent: true});
process.exit(0);
