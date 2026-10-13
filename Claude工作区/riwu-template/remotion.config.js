// TypeScript 7 没有 typescript.sys；给 esbuild-loader 一个空 tsconfigRaw，跳过它读 tsconfig 的分支。
const {Config} = require('@remotion/cli/config');
Config.overrideWebpackConfig((c) => {
  const walk = (rules) => (rules || []).forEach((r) => {
    if (r.oneOf) walk(r.oneOf);
    if (r.rules) walk(r.rules);
    const us = Array.isArray(r.use) ? r.use : r.use ? [r.use] : [];
    us.forEach((u) => { if (u && typeof u === 'object' && String(u.loader || '').includes('esbuild-loader')) u.options = {...(u.options || {}), tsconfigRaw: {compilerOptions: {jsx: 'react-jsx'}}}; });
    if (r.loader && String(r.loader).includes('esbuild-loader')) r.options = {...(r.options || {}), tsconfigRaw: {compilerOptions: {jsx: 'react-jsx'}}};
  });
  walk(c.module && c.module.rules);
  return c;
});
// 浏览器：设了 CHROMIUM_PATH 就用它；否则 Remotion 会自动下载 Chrome Headless Shell。
if (process.env.CHROMIUM_PATH) Config.setBrowserExecutable(process.env.CHROMIUM_PATH);
// 无显卡的 Linux 服务器用软件渲染；Mac/Windows 可以删掉这一行。
Config.setChromiumOpenGlRenderer('swangle');
