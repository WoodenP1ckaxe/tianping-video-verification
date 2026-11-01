import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';
import { nowDateTime } from '../db.js';

function safeLine(value) {
  return String(value ?? '')
    .replaceAll('\r', '')
    .replaceAll('\u0000', '')
    .slice(0, 20_000);
}

function stampForFile(date = new Date()) {
  return nowDateTime(date).replaceAll(/[-: ]/g, '');
}

export class ApplicationLogger {
  constructor({ config, maxBytes = 5 * 1024 * 1024 }) {
    this.root = path.join(config.dataDir, 'logs');
    this.maxBytes = Math.max(64 * 1024, Number(maxBytes) || 5 * 1024 * 1024);
    this.rotationCounter = 0;
    this.statusCache = null;
    mkdirSync(this.root, { recursive: true });
    this.currentDate = nowDateTime().slice(0, 10);
    this.currentPath = path.join(this.root, `application-${this.currentDate}.log`);
  }

  write(level, values) {
    this.statusCache = null;
    const message = values.map((value) => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }).join(' ');
    const line = `${JSON.stringify({
      time: nowDateTime(),
      level,
      message: safeLine(message)
    })}\n`;
    try {
      mkdirSync(this.root, { recursive: true });
      if (this.currentDate !== nowDateTime().slice(0, 10)) {
        this.currentDate = nowDateTime().slice(0, 10);
        this.currentPath = path.join(this.root, `application-${this.currentDate}.log`);
      }
      if (existsSync(this.currentPath) && statSync(this.currentPath).size + Buffer.byteLength(line) > this.maxBytes) {
        this.rotationCounter += 1;
        const rotated = path.join(
          this.root,
          `application-${this.currentDate}-${stampForFile()}-${process.pid}-${this.rotationCounter}.log`
        );
        renameSync(this.currentPath, rotated);
      }
      appendFileSync(this.currentPath, line, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Logging must never take down the application path it is observing.
    }
  }

  debug(...values) {
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() !== 'debug') return;
    this.write('debug', values);
  }

  info(...values) {
    this.write('info', values);
  }

  warn(...values) {
    this.write('warn', values);
  }

  error(...values) {
    this.write('error', values);
  }

  log(...values) {
    this.info(...values);
  }

  listFiles() {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => /^application-.*\.log$/i.test(name))
      .map((name) => {
        const filePath = path.join(this.root, name);
        const stat = statSync(filePath);
        return {
          name,
          size: stat.size,
          modifiedAt: nowDateTime(new Date(stat.mtimeMs))
        };
      })
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  tail(limit = 200) {
    const target = Math.max(1, Math.min(2000, Number(limit) || 200));
    let lines = [];
    const files = this.listFiles()
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    for (const file of files) {
      const content = readFileSync(path.join(this.root, file.name), 'utf8')
        .split(/\r?\n/).filter(Boolean);
      lines = content.concat(lines);
      if (lines.length >= target * 2) break;
    }
    return lines.slice(-target).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { time: '', level: 'unknown', message: line };
      }
    });
  }

  exportText() {
    return this.listFiles()
      .sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt))
      .map((file) => {
        const heading = `# ${file.name} (${file.modifiedAt})\n`;
        return heading + readFileSync(path.join(this.root, file.name), 'utf8');
      })
      .join('\n');
  }

  cleanup(retentionDays = 30) {
    const cutoff = Date.now() - Math.max(30, Number(retentionDays || 30)) * 86_400_000;
    let removed = 0;
    for (const file of this.listFiles()) {
      const filePath = path.join(this.root, file.name);
      try {
        if (statSync(filePath).mtimeMs < cutoff) {
          unlinkSync(filePath);
          removed += 1;
        }
      } catch {
        // A log being read by an operator can be retried on the next cycle.
      }
    }
    if (removed) this.statusCache = null;
    return removed;
  }

  status() {
    if (this.statusCache && Date.now() - this.statusCache.at < 10_000) {
      return this.statusCache.value;
    }
    const files = this.listFiles();
    const value = {
      directory: this.root,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      files: files.slice(0, 50),
      recent: this.tail(80)
    };
    this.statusCache = { at: Date.now(), value };
    return value;
  }
}

export default ApplicationLogger;
