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
      'release',
      'node_modules',
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
    const readoutKeys = new Set();
    for (const readout of manifest.readouts || []) {
      const key = `${readout.point}:${readout.idx}`;
      if (!Number.isInteger(Number(readout.point))
        || Number(readout.point) < 0
        || Number(readout.point) > 2
        || !Number.isInteger(Number(readout.idx))
        || Number(readout.idx) < 1
        || Number(readout.idx) > 3) {
        errors.push(`样例清单 ${name} 的读数键 ${key} 超出 I1-1~I3-3`);
      }
      if (readoutKeys.has(key)) {
        errors.push(`样例清单 ${name} 的读数键 ${key} 重复`);
      }
      readoutKeys.add(key);
      if (!Number.isFinite(Number(readout.value))
        || !Number.isFinite(Number(readout.off))
        || typeof readout.stable !== 'boolean'
        || ![1, 2].includes(Number(readout.range))) {
        errors.push(`样例清单 ${name} 的读数 ${key} 字段不完整`);
      }
    }
    const allowedDeviceCodes = {
      F001: ['F001', 'DZTP170911C'],
      F002: ['F002', 'SJS2605002']
    }[manifest.deviceId] || [manifest.deviceId];
    if (manifest.deviceCard?.code
      && !allowedDeviceCodes.includes(manifest.deviceCard.code)) {
      errors.push(
        `样例清单 ${name} 的设备卡 ${manifest.deviceCard.code} 与 deviceId ${manifest.deviceId} 不一致`
      );
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

try {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  const composeVersion = /^\s*image:\s*tianping-system:([^\s#]+)/m.exec(compose)?.[1];
  const versions = new Set([
    packageJson.version,
    packageLock.version,
    packageLock.packages?.['']?.version,
    composeVersion,
  ]);
  if (versions.size !== 1) {
    errors.push(
      `版本号不一致：package=${packageJson.version}, lock=${packageLock.version}, `
      + `lockRoot=${packageLock.packages?.['']?.version}, compose=${composeVersion}`,
    );
  }
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(packageJson.version)) {
    errors.push(`package.json 版本不是有效的 x.y.z SemVer：${packageJson.version}`);
  }
} catch (error) {
  errors.push(`版本文件校验失败：${error.message}`);
}

for (const file of files.filter((path) => /\.(html|css|js)$/.test(path))) {
  const size = statSync(file).size;
  if (size === 0) errors.push(`${relative(root, file)} 是空文件`);
  const text = readFileSync(file, 'utf8');
  const selfCheck = file === join(root, 'scripts', 'check.js');
  if (!selfCheck && /https?:\/\/(?!127\.0\.0\.1|localhost|\$\{host\}|www\.w3\.org\/2000\/svg)/i.test(text)) {
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
  'src/version.js',
  'public/index.html',
  'docker-compose.yml',
  'README.md',
  'AI_CONTEXT.md',
  'LICENSE',
  'scripts/repo-manager.mjs',
    'scripts/build-release.ps1',
    'scripts/build-windows-control.ps1',
    'scripts/build-app-icon.ps1',
    'scripts/fetch-release-assets.mjs',
    'scripts/smoke-test-windows.ps1',
    'scripts/smoke-test-linux.sh',
    'packaging/windows/TianpingControl.cs',
    'packaging/windows/installer.iss',
    'packaging/linux/install.sh',
    'packaging/linux/service.sh',
    'packaging/linux/uninstall.sh',
    'packaging/linux/README.txt',
    'packaging/assets/使用说明.html',
    'packaging/common/THIRD_PARTY_NOTICES.md',
    'packaging/common/SOURCE_OFFER.txt',
  '.github/workflows/verify.yml',
    '.github/workflows/build-release.yml',
  'docs/README.md',
  'docs/DEPLOYMENT.md',
  'docs/USER_GUIDE.md',
  'docs/TEST_REPORT.md',
  'docs/ACCEPTANCE_TRACE.md',
  'docs/PRODUCT_DECISIONS.md',
    'docs/PACKAGING.md',
    'docs/QUICK_START.md',
  'tests/regressions.test.js',
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

