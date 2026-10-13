// 用同一个浏览器批量渲静帧：node scripts/stills.mjs <plan.json> <outdir> f1,f2,...
import {renderStill, selectComposition, openBrowser} from '@remotion/renderer';
import fs from 'node:fs';
const [planPath, outDir, frames] = process.argv.slice(2);
const props = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const serveUrl = new URL('../build/bundle', import.meta.url).pathname;
fs.mkdirSync(outDir, {recursive: true});
const browser = await openBrowser('chrome', {browserExecutable: process.env.CHROMIUM_PATH || null, chromiumOptions: {gl: 'swangle'}});
const composition = await selectComposition({serveUrl, id: 'Film', inputProps: props, puppeteerInstance: browser});
for (const f of frames.split(',').map(Number)) {
  await renderStill({serveUrl, composition, frame: f, output: `${outDir}/f${String(f).padStart(5, '0')}.jpg`, imageFormat: 'jpeg', jpegQuality: 85, inputProps: props, puppeteerInstance: browser});
}
await browser.close({silent: true});
process.exit(0);
