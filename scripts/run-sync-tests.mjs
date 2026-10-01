// 离线分段合并测试运行器：esbuild 是 vite 的传递依赖，这里经 vite 解析 esbuild 的 JS API 后打包执行。
// 用法：
//   node scripts/run-sync-tests.mjs         # 纯归约逻辑测试
//   node scripts/run-sync-tests.mjs smoke   # 含 Pinia store 的端到端冒烟
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const smoke = process.argv[2] === 'smoke';

// 经 vite 定位其内部使用的 esbuild 安装（pnpm 下 esbuild 不在顶层 node_modules）
const vitePkg = require.resolve('vite/package.json', { paths: [root] });
const esbuildEntry = require.resolve('esbuild', { paths: [dirname(vitePkg)] });
const esbuild = require(esbuildEntry);

const entry = smoke ? join(here, 'sync-store.smoke.ts') : join(here, 'sync-logic.test.ts');
const out = join(here, smoke ? '.smoke.mjs' : '.sync-test.cjs');
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: smoke ? 'esm' : 'cjs',
  outfile: out,
  logLevel: 'silent',
});

const run = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(run.status ?? 0);
