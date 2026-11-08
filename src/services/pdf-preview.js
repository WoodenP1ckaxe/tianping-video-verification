import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HttpError } from '../auth.js';

function findPdfToPpm(config = {}) {
  const candidates = [
    config.pdftoppmPath,
    process.env.PDFTOPPM_PATH,
    'pdftoppm',
    '/usr/bin/pdftoppm',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const checked = spawnSync(candidate, ['-v'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (checked.status === 0 || /pdftoppm version/i.test(`${checked.stdout}${checked.stderr}`)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Preview uses a raster of the exact generated PDF, not a second HTML layout.
 * Poppler is an optional runtime tool; the download/print PDF remains available
 * even when image preview support is unavailable.
 */
export function renderPdfPagePng(pdfBuffer, page = 1, config = {}) {
  const executable = findPdfToPpm(config);
  if (!executable) {
    throw new HttpError(
      501,
      'PDF_PREVIEW_RENDERER_UNAVAILABLE',
      '当前服务器未安装 PDF 预览渲染工具，请使用“打开 PDF 打印”或下载 PDF'
    );
  }
  const pageNumber = Math.max(1, Math.min(50, Number(page) || 1));
  const workDir = mkdtempSync(join(tmpdir(), 'tianping-pdf-preview-'));
  const input = join(workDir, 'document.pdf');
  const prefix = join(workDir, 'page');
  const output = `${prefix}.png`;
  try {
    writeFileSync(input, pdfBuffer);
    const result = spawnSync(executable, [
      '-f', String(pageNumber),
      '-l', String(pageNumber),
      '-singlefile',
      '-png',
      '-r', '120',
      input,
      prefix,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new HttpError(
        500,
        'PDF_PREVIEW_RENDER_FAILED',
        `PDF 预览渲染失败：${String(result.stderr || '未知错误').slice(0, 300)}`
      );
    }
    return readFileSync(output);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
