#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const command = process.argv[2] || 'status';
const commandArgs = process.argv.slice(3);
const branch = 'main';
const githubAccount = 'WoodenP1ckaxe';
const repositoryName = 'tianping-video-verification';
const expectedOrigin = `https://github.com/${githubAccount}/${repositoryName}.git`;
const maxFileBytes = 5 * 1024 * 1024;

const allowedExact = new Set([
  '.dockerignore',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  'AI_CONTEXT.md',
  'ARCHITECTURE.md',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'docker-compose.yml',
  'package-lock.json',
  'package.json',
  'server.js',
]);

const requiredFiles = [
  '.dockerignore',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.github/workflows/verify.yml',
  'AI_CONTEXT.md',
  'ARCHITECTURE.md',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'docker-compose.yml',
  'package-lock.json',
  'package.json',
  'public/index.html',
  'samples/manifests',
  'scripts/check.js',
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
  'server.js',
  'src/api.js',
  'src/auth.js',
  'src/db.js',
  'src/services/display-ocr.js',
  'src/rules.js',
  'src/version.js',
  'docs/README.md',
  'docs/DEPLOYMENT.md',
  'docs/USER_GUIDE.md',
  'docs/TEST_REPORT.md',
  'docs/ACCEPTANCE_TRACE.md',
  'docs/PRODUCT_DECISIONS.md',
  'docs/PACKAGING.md',
  'docs/QUICK_START.md',
  'tests',
];

const secretPatterns = [
  {
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    label: 'private key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    label: 'hard-coded API secret',
    pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][A-Za-z0-9_./+=-]{20,}['"]/i,
  },
];

function run(program, args, options = {}) {
  try {
    const output = execFileSync(program, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    return typeof output === 'string' ? output.trim() : output;
  } catch (error) {
    if (options.allowFailure) return null;
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(`${program} ${args.join(' ')} 失败：${detail}`);
  }
}

function git(args, options = {}) {
  return run('git', ['-c', `safe.directory=${normalize(root)}`, '-C', root, ...args], options);
}

function splitNull(value) {
  return (value || '').split('\0').filter(Boolean);
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

function parseJsonFile(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function versionState() {
  const packageJson = parseJsonFile('package.json');
  const packageLock = parseJsonFile('package-lock.json');
  const composeText = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  const composeMatch = composeText.match(/^(\s*image:\s*tianping-system:)([^\s#]+)(.*)$/m);
  return {
    packageJson,
    packageLock,
    composeText,
    composeMatch,
    packageVersion: packageJson.version,
    lockVersion: packageLock.version,
    lockRootVersion: packageLock.packages?.['']?.version,
    composeVersion: composeMatch?.[2] || null,
  };
}

function versionErrors() {
  const state = versionState();
  const errors = [];
  const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
  if (!semver.test(String(state.packageVersion || ''))) {
    errors.push(`package.json 版本不是有效的 x.y.z SemVer：${state.packageVersion}`);
  }
  const versions = new Set([
    state.packageVersion,
    state.lockVersion,
    state.lockRootVersion,
    state.composeVersion,
  ]);
  if (versions.size !== 1) {
    errors.push(
      `版本号不一致：package=${state.packageVersion}, lock=${state.lockVersion}, `
      + `lockRoot=${state.lockRootVersion}, compose=${state.composeVersion}`,
    );
  }
  return errors;
}

function bumpPartFromArgs() {
  const index = commandArgs.findIndex((value) => value === '--bump');
  const part = index === -1 ? 'patch' : commandArgs[index + 1];
  if (!['patch', 'minor', 'major'].includes(part)) {
    throw new Error('--bump 仅支持 patch、minor 或 major');
  }
  return part;
}

function nextVersion(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error(`无法递增无效版本号：${version}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (part === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (part === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function applyVersionBump(part) {
  const consistencyErrors = versionErrors();
  if (consistencyErrors.length > 0) {
    throw new Error(consistencyErrors.join('；'));
  }
  const state = versionState();
  const oldVersion = state.packageVersion;
  const newVersion = nextVersion(oldVersion, part);
  const tag = `v${newVersion}`;
  if (git(['rev-parse', '--quiet', `refs/tags/${tag}`], { allowFailure: true })) {
    throw new Error(`Git 标签 ${tag} 已存在，请检查当前版本号`);
  }

  const packageJson = {
    ...state.packageJson,
    version: newVersion,
  };
  const packageLock = {
    ...state.packageLock,
    version: newVersion,
    packages: {
      ...state.packageLock.packages,
      '': {
        ...(state.packageLock.packages?.[''] || {}),
        version: newVersion,
      },
    },
  };
  const composeText = state.composeText.replace(
    /^(\s*image:\s*tianping-system:)([^\s#]+)(.*)$/m,
    `$1${newVersion}$3`,
  );
  const changes = [
    {
      path: 'package.json',
      before: readFileSync(join(root, 'package.json'), 'utf8'),
      after: `${JSON.stringify(packageJson, null, 2)}\n`,
    },
    {
      path: 'package-lock.json',
      before: readFileSync(join(root, 'package-lock.json'), 'utf8'),
      after: `${JSON.stringify(packageLock, null, 2)}\n`,
    },
    {
      path: 'docker-compose.yml',
      before: state.composeText,
      after: composeText,
    },
  ];

  try {
    for (const change of changes) {
      writeFileSync(join(root, change.path), change.after, 'utf8');
    }
  } catch (error) {
    for (const change of changes) {
      writeFileSync(join(root, change.path), change.before, 'utf8');
    }
    throw error;
  }
  return {
    oldVersion,
    newVersion,
    tag,
    files: changes.map((change) => change.path),
    changes,
  };
}

function restoreVersionFiles(release) {
  if (!release) return;
  for (const change of release.changes) {
    writeFileSync(join(root, change.path), change.before, 'utf8');
  }
}

function isAllowed(path) {
  const normalized = normalize(path);
  if (allowedExact.has(normalized)) return true;
  if (normalized === '.github/workflows/verify.yml') return true;
  if (normalized === '.github/workflows/build-release.yml') return true;
  if (/^public\/(?:index\.html|favicon\.svg|assets\/[A-Za-z0-9._-]+\.(?:css|js|svg))$/.test(normalized)) {
    return true;
  }
  if (/^src\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js$/.test(normalized)) return true;
  if (/^samples\/manifests\/[A-F0-9]{64}\.json$/.test(normalized)) return true;
  if (/^scripts\/[A-Za-z0-9._-]+\.(?:js|mjs|ps1|sh)$/.test(normalized)) return true;
  if (/^packaging\/windows\/[A-Za-z0-9._-]+\.(?:cs|iss)$/.test(normalized)) return true;
  if (/^packaging\/linux\/[A-Za-z0-9._-]+\.(?:sh|txt)$/.test(normalized)) return true;
  if (/^packaging\/(?:assets|common)\/[^/]+\.(?:html|md|txt)$/.test(normalized)) return true;
  if (/^docs\/[A-Za-z0-9._-]+\.md$/.test(normalized)) return true;
  if (/^tests\/[A-Za-z0-9._-]+\.js$/.test(normalized)) return true;
  return false;
}

function forbiddenReason(path) {
  const normalized = normalize(path);
  const deliveryOnly = [
    /^verification\//i,
    /^data(?:\/|$)/i,
    /^backups(?:\/|$)/i,
  ];
  if (deliveryOnly.some((pattern) => pattern.test(normalized))) {
    return '属于本地交付物或运行数据';
  }
  if (/\.(?:db|sqlite|sqlite3|log|pid|mp4|mov|avi|mkv|png|jpe?g|pdf|docx?|pptx?|xlsx?)$/i.test(normalized)) {
    return '属于媒体、数据库、日志或办公交付物';
  }
  return null;
}

function isRepository() {
  return git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }) === 'true';
}

function candidateFiles() {
  const tracked = splitNull(git(['ls-files', '-z']));
  const staged = splitNull(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
  const untracked = splitNull(git(['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([...tracked, ...staged, ...untracked].map(normalize))].sort();
}

function checkPolicy({ quiet = false } = {}) {
  if (!isRepository()) {
    throw new Error('当前目录不是 Git 仓库，请先运行 node scripts/repo-manager.mjs init');
  }

  const errors = [];
  const files = candidateFiles();
  for (const path of files) {
    if (!isAllowed(path)) {
      const reason = forbiddenReason(path);
      errors.push(`${path}${reason ? `（${reason}）` : ''}不在源码发布允许清单中`);
      continue;
    }
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const stats = lstatSync(absolute);
    if (!stats.isFile()) {
      errors.push(`${path} 不是普通文件`);
      continue;
    }
    if (stats.size > maxFileBytes) {
      errors.push(`${path} 超过单文件 ${Math.floor(maxFileBytes / 1024 / 1024)} MiB 限制`);
      continue;
    }
    const textExtension = /\.(?:js|mjs|json|md|css|html|svg|ya?ml|sh|ps1|cs|iss|txt|example|gitignore|gitattributes|dockerignore)$/i;
    if (!textExtension.test(path) && !['Dockerfile', 'LICENSE'].includes(path)) {
      errors.push(`${path} 的文件类型未获发布策略批准`);
      continue;
    }
    if (path !== '.env.example') {
      const text = readFileSync(absolute, 'utf8');
      for (const secret of secretPatterns) {
        if (secret.pattern.test(text)) errors.push(`${path} 疑似包含${secret.label}`);
      }
    }
  }

  for (const path of requiredFiles) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) errors.push(`缺少必需文件或目录：${path}`);
  }

  for (const path of splitNull(git(['ls-files', '-z']))) {
    const normalized = normalize(path);
    if (forbiddenReason(normalized)) errors.push(`Git 已跟踪禁止发布的文件：${normalized}`);
  }
  errors.push(...versionErrors());

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    throw new Error(`发布策略检查失败，共 ${errors.length} 项`);
  }
  if (!quiet) {
    console.log(`发布策略通过：${files.length} 个候选实现文件，敏感内容与排除目录检查正常。`);
  }
}

function runSourceCheck() {
  run(process.execPath, [join(root, 'scripts', 'check.js')], { stdio: 'inherit' });
}

function branchName() {
  return git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
}

function status() {
  checkPolicy();
  const current = branchName() || '(detached)';
  const remote = git(['remote', 'get-url', 'origin'], { allowFailure: true }) || '(未配置)';
  console.log(`分支：${current}`);
  console.log(`远端：${remote}`);
  const worktree = git(['status', '--short', '--branch']);
  console.log(worktree || '工作区干净');
}

function init() {
  if (!existsSync(join(root, '.git'))) {
    run('git', ['init', '-b', branch]);
    console.log(`已初始化 Git 仓库，默认分支 ${branch}。`);
  } else {
    console.log('Git 仓库已存在，未重复初始化。');
  }

  const currentRemote = git(['remote', 'get-url', 'origin'], { allowFailure: true });
  if (!currentRemote) {
    git(['remote', 'add', 'origin', expectedOrigin]);
    console.log(`已配置 origin：${expectedOrigin}`);
  } else if (normalize(currentRemote) !== expectedOrigin) {
    throw new Error(`origin 为 ${currentRemote}，与预期 ${expectedOrigin} 不一致`);
  } else {
    console.log(`origin 已正确配置：${expectedOrigin}`);
  }
}

function messageFromArgs() {
  const messageIndex = commandArgs.findIndex((value) => value === '-m' || value === '--message');
  if (messageIndex !== -1) {
    const message = commandArgs.slice(messageIndex + 1).join(' ').trim();
    if (message) return message;
  }
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `chore: automatic source backup ${stamp}`;
}

function commitIfNeeded(message) {
  git(['add', '-A']);
  const initialStaged = splitNull(git(['diff', '--cached', '--name-only', '-z']));
  if (initialStaged.length === 0) {
    console.log('没有需要提交的源码变化。');
    return null;
  }
  checkPolicy({ quiet: true });

  let release = null;
  let committed = false;
  try {
    release = applyVersionBump(bumpPartFromArgs());
    git(['add', ...release.files]);
    checkPolicy({ quiet: true });
    const staged = splitNull(git(['diff', '--cached', '--name-only', '-z']));
    const versionedMessage = `${message.replace(/\s+$/, '')} (v${release.newVersion})`;
    git(['commit', '-m', versionedMessage]);
    committed = true;
    git(['tag', '-a', release.tag, '-m', `Release ${release.tag}`]);
    console.log(`版本：${release.oldVersion} -> ${release.newVersion}（${bumpPartFromArgs()}）`);
    console.log(`已提交 ${staged.length} 个文件并创建标签 ${release.tag}：${versionedMessage}`);
    return release;
  } catch (error) {
    if (!committed && release) {
      restoreVersionFiles(release);
      git(['add', ...release.files]);
    }
    throw error;
  }
}

function githubToken() {
  const credential = run('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    env: {
      ...process.env,
      GCM_INTERACTIVE: 'Never',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  const passwordLine = credential
    .split(/\r?\n/)
    .find((line) => line.startsWith('password='));
  if (!passwordLine) throw new Error('未找到 GitHub 凭据，请先运行 github login');
  return passwordLine.slice('password='.length);
}

async function githubRequest(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'tianping-repository-manager',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  return { response, data };
}

async function createGitHubRepository() {
  init();
  const token = githubToken();
  const user = await githubRequest(token, 'GET', '/user');
  if (!user.response.ok) throw new Error(`GitHub 身份检查失败：${user.data?.message || user.response.status}`);
  if (String(user.data?.login).toLowerCase() !== githubAccount.toLowerCase()) {
    throw new Error(`当前 GitHub 登录账号为 ${user.data?.login}，预期为 ${githubAccount}`);
  }

  let repository = await githubRequest(token, 'GET', `/repos/${githubAccount}/${repositoryName}`);
  if (repository.response.status === 404) {
    repository = await githubRequest(token, 'POST', '/user/repos', {
      name: repositoryName,
      description: 'Source backup for the electronic balance verification video analysis system.',
      private: false,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
      auto_init: false,
    });
    if (!repository.response.ok) {
      throw new Error(`创建 GitHub 仓库失败：${repository.data?.message || repository.response.status}`);
    }
  } else if (!repository.response.ok) {
    throw new Error(`检查 GitHub 仓库失败：${repository.data?.message || repository.response.status}`);
  }

  if (repository.data?.private !== false) {
    throw new Error('目标 GitHub 仓库不是公开仓库，已停止');
  }
  console.log(`GitHub 公开仓库已就绪：${repository.data.html_url}`);
}

function verifyOrigin() {
  const origin = git(['remote', 'get-url', 'origin'], { allowFailure: true });
  if (!origin) throw new Error('未配置 origin');
  if (normalize(origin) !== expectedOrigin) {
    throw new Error(`仅允许推送到 ${expectedOrigin}，当前 origin 为 ${origin}`);
  }
}

function check() {
  checkPolicy();
  runSourceCheck();
}

function exactTagAtHead() {
  return git(['describe', '--tags', '--exact-match', 'HEAD'], { allowFailure: true });
}

function commit() {
  backup();
}

function backup() {
  verifyOrigin();
  if (branchName() !== branch) {
    throw new Error(`当前分支不是 ${branch}，拒绝自动备份`);
  }
  check();
  const release = commitIfNeeded(messageFromArgs());
  const releaseTag = release?.tag || exactTagAtHead();

  git([
    'push',
    '--porcelain',
    '--follow-tags',
    '--set-upstream',
    'origin',
    branch,
  ], { stdio: 'inherit' });
  if (releaseTag) {
    git(['push', '--porcelain', 'origin', `refs/tags/${releaseTag}`], { stdio: 'inherit' });
  }
  const localHead = git(['rev-parse', 'HEAD']);
  const remoteLine = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
  const remoteHead = remoteLine.split(/\s+/)[0];
  if (!remoteHead || remoteHead !== localHead) {
    throw new Error('推送后远端 HEAD 与本地不一致，请检查 GitHub 状态');
  }
  if (releaseTag) {
    const localTag = git(['rev-parse', releaseTag]);
    const remoteTagLine = git(['ls-remote', 'origin', `refs/tags/${releaseTag}`]);
    const remoteTag = remoteTagLine.split(/\s+/)[0];
    if (!remoteTag || remoteTag !== localTag) {
      throw new Error(`推送后远端标签 ${releaseTag} 与本地不一致`);
    }
  }
  console.log(`GitHub 已同步提交与版本标签：${localHead}`);
}

try {
  if (command === 'init') init();
  else if (command === 'status') status();
  else if (command === 'check') check();
  else if (command === 'create') await createGitHubRepository();
  else if (command === 'commit') commit();
  else if (command === 'backup') backup();
  else {
    console.error('用法：node scripts/repo-manager.mjs init|status|check|create|commit|backup [-m "提交说明"]');
    process.exit(2);
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exit(1);
}
