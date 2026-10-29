import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const databasePath = process.env.DATABASE_PATH || join(dataDir, 'tianping.db');
const backupDir = resolve(process.env.BACKUP_DIR || join(root, 'backups'));
const command = process.argv[2] || 'status';

function stamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function status() {
  const exists = existsSync(databasePath);
  console.log(JSON.stringify({
    dataDir,
    databasePath,
    databaseExists: exists,
    databaseBytes: exists ? statSync(databasePath).size : 0,
    backupDir,
    backups: existsSync(backupDir)
      ? readdirSync(backupDir).filter((name) => name.endsWith('.db')).sort()
      : [],
  }, null, 2));
}

function backup() {
  if (!existsSync(databasePath)) throw new Error(`数据库不存在：${databasePath}`);
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `tianping-${stamp()}.db`);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    const result = check.prepare('PRAGMA integrity_check').get();
    const value = Object.values(result || {})[0];
    if (value !== 'ok') throw new Error(`备份完整性检查失败：${value}`);
  } finally {
    check.close();
  }
  console.log(`备份完成：${target}`);
}

function verify() {
  const target = process.argv[3] ? resolve(process.argv[3]) : findLatestBackup();
  if (!target || !existsSync(target)) throw new Error('未找到待验证备份');
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').get();
    const value = Object.values(result || {})[0];
    if (value !== 'ok') throw new Error(`完整性检查失败：${value}`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log(`备份有效：${target}`);
    console.log(`数据表：${tables.map((row) => row.name).join('、')}`);
  } finally {
    db.close();
  }
}

function findLatestBackup() {
  if (!existsSync(backupDir)) return null;
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => join(backupDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return files[0] || null;
}

function prune() {
  if (!existsSync(backupDir)) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(backupDir).filter((item) => item.endsWith('.db'))) {
    const path = join(backupDir, name);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      console.log(`已清理超过 30 天的备份：${basename(path)}`);
    }
  }
}

try {
  if (command === 'status') status();
  else if (command === 'backup') backup();
  else if (command === 'verify') verify();
  else if (command === 'prune') prune();
  else {
    console.error('用法：node scripts/maintenance.js status|backup|verify [备份路径]|prune');
    process.exit(2);
  }
} catch (error) {
  console.error(`维护命令失败：${error.message}`);
  process.exit(1);
}

