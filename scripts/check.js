import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const warnings = [];
const expectedHashes = new Set([
  '574C0617BAE5AAD69AD7B318EE59F5E22C87311DC0D4931CB1E5D90148A30B32',
  '920B7864BC2ED6D0A006189AF47613854B7F2FA630E9504FC43378615CAE23AE',
  'EBCF18D525394DA664FFC37AD4FE691ADE2C33FF0106B4343B410E322EBCEFD0',
]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const localOnly = new Set([
      '.git',
      'backups',
      'data',
      'docs',
      'node_modules',
      'tests',
      'verification',
    ]);
    if (localOnly.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root);
for (const file of files.filter((path) => path.endsWith('.js') || path.endsWith('.mjs'))) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) {
    errors.push(`${relative(root, file)}: ${checked.stderr.trim()}`);
  }
}

const manifestDir = join(root, 'samples', 'manifests');
const manifests = existsSync(manifestDir)
  ? readdirSync(manifestDir).filter((name) => name.endsWith('.json'))
  : [];
for (const name of manifests) {
  try {
    const manifest = JSON.parse(readFileSync(join(manifestDir, name), 'utf8'));
    if (!Array.isArray(manifest.readouts) || manifest.readouts.length !== 9) {
      errors.push(`样例清单 ${name} 必须包含 9 个读数`);
    }
    if (!expectedHashes.has(name.replace(/\.json$/i, '').toUpperCase())) {
      warnings.push(`样例清单 ${name} 不在当前客户三段视频哈希清单中`);
    }
  } catch (error) {
    errors.push(`样例清单 ${name} 不是有效 JSON：${error.message}`);
  }
}
if (manifests.length !== expectedHashes.size) {
  errors.push(`样例清单数量应为 ${expectedHashes.size}，实际 ${manifests.length}`);
}

for (const file of files.filter((path) => /\.(html|css|js)$/.test(path))) {
  const size = statSync(file).size;
  if (size === 0) errors.push(`${relative(root, file)} 是空文件`);
  const text = readFileSync(file, 'utf8');
  const selfCheck = file === join(root, 'scripts', 'check.js');
  if (!selfCheck && /https?:\/\/(?!127\.0\.0\.1|localhost|\$\{host\})/i.test(text)) {
    warnings.push(`${relative(root, file)} 包含外部 URL，请确认不是运行时依赖`);
  }
  if (!selfCheck && /\bTODO\b|待实现|原型模拟/.test(text)) {
    warnings.push(`${relative(root, file)} 含未完成/原型措辞`);
  }
}

const required = [
  'server.js',
  'src/api.js',
  'src/auth.js',
  'src/db.js',
  'src/rules.js',
  'src/services/analyzer.js',
  'src/services/exporter.js',
  'src/services/queue.js',
  'public/index.html',
  'docker-compose.yml',
  'README.md',
  'AI_CONTEXT.md',
  'LICENSE',
  'scripts/repo-manager.mjs',
  '.github/workflows/verify.yml',
];
for (const path of required) {
  if (!existsSync(join(root, path))) errors.push(`缺少交付文件：${path}`);
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) {
  console.error(`\n检查失败：${errors.length} 个错误，${warnings.length} 个警告。`);
  process.exit(1);
}
console.log(`检查通过：${files.length} 个文件，${manifests.length} 个样例清单，${warnings.length} 个警告。`);

