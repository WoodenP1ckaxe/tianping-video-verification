import { PDFiumLibrary } from '@hyzyla/pdfium';
import { PNG } from 'pngjs';
import { HttpError } from '../auth.js';

const PDFIUM_SCALE = 120 / 72;
let pdfiumLibraryPromise = null;
let renderTail = Promise.resolve();

function withPdfium(action) {
  const previous = renderTail;
  let release;
  renderTail = new Promise((resolve) => {
    release = resolve;
  });

  return previous
    .then(async () => {
      if (!pdfiumLibraryPromise) {
        pdfiumLibraryPromise = PDFiumLibrary.init().catch((error) => {
          pdfiumLibraryPromise = null;
          throw error;
        });
      }
      const library = await pdfiumLibraryPromise;
      return action(library);
    })
    .finally(release);
}

/**
 * PDFium is compiled to WebAssembly and shipped with the application. Keeping
 * preview rendering in-process removes the former host-level Poppler
 * dependency and gives Windows and Linux the same output path.
 */
export function getPdfPreviewStatus() {
  return {
    available: true,
    engine: 'pdfium-wasm-3.0.0'
  };
}

export function renderPdfPagePng(pdfBuffer, page = 1, _config = {}) {
  const status = getPdfPreviewStatus();
  if (!status.available) {
    throw new HttpError(
      501,
      'PDF_PREVIEW_RENDERER_UNAVAILABLE',
      '当前安装未包含 PDF 预览组件，请使用“打开 PDF 打印”或下载 PDF'
    );
  }

  return withPdfium(async (library) => {
    let document;
    let pdfPage;
    try {
      document = await library.loadDocument(new Uint8Array(pdfBuffer));
      const pageCount = document.getPageCount();
      if (!pageCount) throw new Error('PDF 没有可预览页面');
      const pageNumber = Math.max(1, Math.min(pageCount, Number(page) || 1));
      pdfPage = document.getPage(pageNumber - 1);
      const rendered = await pdfPage.render({
        scale: PDFIUM_SCALE,
        render: 'bitmap',
        colorSpace: 'RGBA',
        renderFormFields: true
      });
      return PNG.sync.write({
        width: rendered.width,
        height: rendered.height,
        data: Buffer.from(rendered.data),
        colorType: 6,
        inputColorType: 6,
        inputHasAlpha: true
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        'PDF_PREVIEW_RENDER_FAILED',
        `PDF 预览渲染失败：${String(error?.message || error).slice(0, 300)}`
      );
    } finally {
      pdfPage?.close();
      document?.destroy();
    }
  });
}
