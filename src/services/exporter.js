import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import {
  evaluateRecord,
  formatNumber,
  judgementBasis,
  signedNumber,
} from '../rules.js';

const A4_PORTRAIT = Object.freeze({ width: 595.28, height: 841.89 });
const A4_LANDSCAPE = Object.freeze({ width: 841.89, height: 595.28 });
const FONT_CANDIDATES = Object.freeze([
  process.env.PDF_FONT_PATH,
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\Deng.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/unifont/unifont.ttf',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
].filter(Boolean));

const STATUS_WATERMARK = Object.freeze({
  '待提交': '未复核',
  '已提交': '未复核',
  '已作废': '已作废',
});

let loadedFontCache = null;

function align4(value) {
  return (value + 3) & ~3;
}

function uint16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) throw new RangeError('字体文件结构越界');
  return buffer.readUInt16BE(offset);
}

function int16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) throw new RangeError('字体文件结构越界');
  return buffer.readInt16BE(offset);
}

function uint32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) throw new RangeError('字体文件结构越界');
  return buffer.readUInt32BE(offset);
}

function tagAt(buffer, offset) {
  return buffer.toString('ascii', offset, offset + 4);
}

function readTableDirectory(buffer, faceOffset = 0) {
  const version = buffer.toString('ascii', faceOffset, faceOffset + 4);
  if (!['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'typ1'].includes(version)) {
    throw new Error('不是可识别的 TrueType/OpenType 字体');
  }
  const numTables = uint16(buffer, faceOffset + 4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const offset = faceOffset + 12 + index * 16;
    tables.set(tagAt(buffer, offset), {
      checksum: uint32(buffer, offset + 4),
      offset: uint32(buffer, offset + 8),
      length: uint32(buffer, offset + 12),
    });
  }
  return { version, numTables, tables };
}

/**
 * 将 TTC 中的指定字体面抽取为独立 SFNT。PDF 的 FontFile2 不应直接嵌入整个集合。
 */
function extractFontFace(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') !== 'ttcf') {
    return buffer;
  }
  const count = uint32(buffer, 8);
  if (!count) throw new Error('字体集合为空');
  const faceOffset = uint32(buffer, 12);
  const directory = readTableDirectory(buffer, faceOffset);
  const entries = [...directory.tables.entries()];
  const headerLength = 12 + entries.length * 16;
  const parts = [];
  let outputLength = headerLength;
  for (const [, table] of entries) {
    outputLength = align4(outputLength);
    outputLength += table.length;
  }
  const output = Buffer.alloc(outputLength);
  buffer.copy(output, 0, faceOffset, faceOffset + 12);
  let cursor = headerLength;
  let directoryOffset = 12;
  for (const [tag, table] of entries) {
    cursor = align4(cursor);
    output.write(tag, directoryOffset, 4, 'ascii');
    output.writeUInt32BE(table.checksum, directoryOffset + 4);
    output.writeUInt32BE(cursor, directoryOffset + 8);
    output.writeUInt32BE(table.length, directoryOffset + 12);
    buffer.copy(output, cursor, table.offset, table.offset + table.length);
    cursor += table.length;
    directoryOffset += 16;
  }
  parts.push(output);
  return parts[0];
}

function findCmapSubtable(buffer, table) {
  const base = table.offset;
  const numTables = uint16(buffer, base + 2);
  const candidates = [];
  for (let index = 0; index < numTables; index += 1) {
    const record = base + 4 + index * 8;
    const platform = uint16(buffer, record);
    const encoding = uint16(buffer, record + 2);
    const offset = base + uint32(buffer, record + 4);
    const format = uint16(buffer, offset);
    const preference = format === 12
      ? (platform === 3 && encoding === 10 ? 100 : 90)
      : format === 4
        ? (platform === 3 && encoding === 1 ? 80 : 70)
        : 0;
    if (preference) candidates.push({ format, offset, preference });
  }
  candidates.sort((left, right) => right.preference - left.preference);
  return candidates[0] || null;
}

function createCmapLookup(buffer, table) {
  const subtable = findCmapSubtable(buffer, table);
  if (!subtable) throw new Error('字体缺少 Unicode cmap');

  if (subtable.format === 12) {
    const base = subtable.offset;
    const groups = uint32(buffer, base + 12);
    return (codePoint) => {
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const record = base + 16 + middle * 12;
        const start = uint32(buffer, record);
        const end = uint32(buffer, record + 4);
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return uint32(buffer, record + 8) + (codePoint - start);
      }
      return 0;
    };
  }

  const base = subtable.offset;
  const segmentCount = uint16(buffer, base + 6) / 2;
  const endCodes = base + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const idDeltas = startCodes + segmentCount * 2;
  const idRangeOffsets = idDeltas + segmentCount * 2;
  return (codePoint) => {
    if (codePoint > 0xffff) return 0;
    for (let index = 0; index < segmentCount; index += 1) {
      const end = uint16(buffer, endCodes + index * 2);
      if (codePoint > end) continue;
      const start = uint16(buffer, startCodes + index * 2);
      if (codePoint < start) return 0;
      const delta = int16(buffer, idDeltas + index * 2);
      const rangeOffsetAddress = idRangeOffsets + index * 2;
      const rangeOffset = uint16(buffer, rangeOffsetAddress);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - start) * 2;
      const glyph = uint16(buffer, glyphAddress);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function loadFont() {
  if (loadedFontCache) return loadedFontCache;
  const path = FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      '未找到可嵌入的中文字体。请配置 PDF_FONT_PATH，或安装 Noto Sans CJK / 文泉驿正黑。',
    );
  }
  const source = readFileSync(path);
  const fontData = extractFontFace(source);
  const directory = readTableDirectory(fontData);
  for (const tag of ['head', 'hhea', 'hmtx', 'cmap', 'maxp', 'loca', 'glyf']) {
    if (!directory.tables.has(tag)) {
      throw new Error(`中文字体缺少必要表 ${tag}：${path}`);
    }
  }
  const head = directory.tables.get('head');
  const hhea = directory.tables.get('hhea');
  const hmtx = directory.tables.get('hmtx');
  const cmap = directory.tables.get('cmap');
  const unitsPerEm = uint16(fontData, head.offset + 18) || 1000;
  const numberOfHMetrics = uint16(fontData, hhea.offset + 34);
  const lookupGlyph = createCmapLookup(fontData, cmap);

  const glyphWidth = (glyphId) => {
    const index = Math.min(Math.max(0, glyphId), Math.max(0, numberOfHMetrics - 1));
    return uint16(fontData, hmtx.offset + index * 4) || unitsPerEm;
  };

  loadedFontCache = {
    path,
    data: fontData,
    name: 'NotoSansCJK',
    unitsPerEm,
    glyphWidth,
    lookupGlyph,
    bbox: [
      int16(fontData, head.offset + 36),
      int16(fontData, head.offset + 38),
      int16(fontData, head.offset + 40),
      int16(fontData, head.offset + 42),
    ],
    ascent: int16(fontData, hhea.offset + 4),
    descent: int16(fontData, hhea.offset + 6),
    size: statSync(path).size,
  };
  return loadedFontCache;
}

function codePoints(text) {
  return Array.from(String(text ?? ''), (character) => character.codePointAt(0));
}

function utf16Hex(codePoint) {
  if (codePoint <= 0xffff) return codePoint.toString(16).toUpperCase().padStart(4, '0');
  const value = codePoint - 0x10000;
  const high = 0xd800 + (value >> 10);
  const low = 0xdc00 + (value & 0x3ff);
  return `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`.toUpperCase();
}

class PdfDocument {
  constructor(options = {}) {
    this.font = loadFont();
    this.pages = [];
    this.usedGlyphs = new Map();
    this.title = options.title || '天平校验记录';
    this.author = options.author || '天平校验视频分析系统';
    this.createdAt = options.createdAt || new Date();
  }

  addPage(width = A4_PORTRAIT.width, height = A4_PORTRAIT.height) {
    this.pages.push({ width, height, commands: [] });
    return this.pages.length - 1;
  }

  get currentPage() {
    return this.pages.at(-1);
  }

  glyphFor(codePoint) {
    let glyph = this.font.lookupGlyph(codePoint);
    if (!glyph) glyph = this.font.lookupGlyph(0x003f);
    if (!glyph) glyph = 1;
    this.usedGlyphs.set(glyph, codePoint);
    return glyph;
  }

  encodeHex(text) {
    const bytes = [];
    for (const codePoint of codePoints(text)) {
      const glyph = this.glyphFor(codePoint);
      bytes.push((glyph >> 8) & 0xff, glyph & 0xff);
    }
    return Buffer.from(bytes).toString('hex').toUpperCase();
  }

  measure(text, fontSize) {
    return codePoints(text).reduce((total, codePoint) => {
      const glyph = this.font.lookupGlyph(codePoint) || this.font.lookupGlyph(0x003f) || 1;
      return total + this.font.glyphWidth(glyph) / this.font.unitsPerEm * fontSize;
    }, 0);
  }

  wrap(text, maxWidth, fontSize) {
    const paragraphs = String(text ?? '').replaceAll('\r\n', '\n').split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const character of Array.from(paragraph)) {
        const candidate = line + character;
        if (line && this.measure(candidate, fontSize) > maxWidth) {
          lines.push(line);
          line = character;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  text(x, baselineY, text, options = {}) {
    if (!this.currentPage) this.addPage();
    const size = options.size || 10;
    const color = options.color || [0, 0, 0];
    const encoded = this.encodeHex(text);
    this.currentPage.commands.push(
      `q ${color.map((value) => Number(value).toFixed(3)).join(' ')} rg ` +
      `BT /F1 ${Number(size).toFixed(2)} Tf ${Number(x).toFixed(2)} ${Number(baselineY).toFixed(2)} Td ` +
      `<${encoded}> Tj ET Q`,
    );
  }

  centeredText(x, width, baselineY, text, options = {}) {
    const measured = this.measure(text, options.size || 10);
    this.text(x + Math.max(0, (width - measured) / 2), baselineY, text, options);
  }

  line(x1, y1, x2, y2, options = {}) {
    if (!this.currentPage) this.addPage();
    const width = options.width || 0.6;
    const color = options.color || [0.25, 0.29, 0.33];
    this.currentPage.commands.push(
      `q ${color.map((value) => Number(value).toFixed(3)).join(' ')} RG ` +
      `${Number(width).toFixed(2)} w ${Number(x1).toFixed(2)} ${Number(y1).toFixed(2)} m ` +
      `${Number(x2).toFixed(2)} ${Number(y2).toFixed(2)} l S Q`,
    );
  }

  rect(x, y, width, height, options = {}) {
    if (!this.currentPage) this.addPage();
    const fill = options.fill;
    const stroke = options.stroke === false ? false : (options.stroke || [0.55, 0.59, 0.63]);
    const lineWidth = options.width || 0.55;
    let command = 'q ';
    if (fill) {
      command += `${fill.map((value) => Number(value).toFixed(3)).join(' ')} rg `;
    }
    if (stroke) {
      command += `${stroke.map((value) => Number(value).toFixed(3)).join(' ')} RG ${Number(lineWidth).toFixed(2)} w `;
    }
    command += `${Number(x).toFixed(2)} ${Number(y).toFixed(2)} ${Number(width).toFixed(2)} ${Number(height).toFixed(2)} re `;
    if (fill && stroke) command += 'B Q';
    else if (fill) command += 'f Q';
    else command += 'S Q';
    this.currentPage.commands.push(command);
  }

  cell(x, top, width, height, text, options = {}) {
    const y = this.currentPage.height - top - height;
    this.rect(x, y, width, height, {
      fill: options.fill || [1, 1, 1],
      stroke: options.stroke || [0.45, 0.49, 0.53],
    });
    const lines = this.wrap(text, Math.max(1, width - 8), options.size || 8.5);
    const lineHeight = (options.size || 8.5) * 1.25;
    const visible = Math.max(1, Math.floor((height - 4) / lineHeight));
    const shown = lines.slice(0, visible);
    const startY = y + height / 2 + (shown.length - 1) * lineHeight / 2 - (options.size || 8.5) * 0.35;
    shown.forEach((line, index) => {
      const textY = startY - index * lineHeight;
      if (options.align === 'center') {
        this.centeredText(x, width, textY, line, options);
      } else if (options.align === 'right') {
        const measured = this.measure(line, options.size || 8.5);
        this.text(x + width - measured - 4, textY, line, options);
      } else {
        this.text(x + 4, textY, line, options);
      }
    });
  }

  finish() {
    if (!this.pages.length) this.addPage();
    const pageObjects = [];
    const contentObjects = [];
    let nextObject = 8;
    for (let index = 0; index < this.pages.length; index += 1) {
      const contentObject = nextObject + 1;
      const pageObject = nextObject;
      pageObjects.push(pageObject);
      contentObjects.push(contentObject);
      nextObject += 2;
    }

    const contentStreams = this.pages.map((page) => (
      `q 0.55 0.59 0.63 RG 0.55 w 42 ${Math.max(28, page.height * 0.04)} ` +
      `${page.width - 84} ${page.height - Math.max(28, page.height * 0.04) * 2} re S Q\n` +
      page.commands.join('\n')
    ));

    const widthEntries = [];
    for (const glyph of [...this.usedGlyphs.keys()].sort((a, b) => a - b)) {
      const width = Math.round(this.font.glyphWidth(glyph) / this.font.unitsPerEm * 1000);
      widthEntries.push(`${glyph} [${width}]`);
    }

    const cmapEntries = [];
    for (const [glyph, codePoint] of this.usedGlyphs.entries()) {
      cmapEntries.push(
        `<${glyph.toString(16).toUpperCase().padStart(4, '0')}> <${utf16Hex(codePoint)}>`,
      );
    }
    const chunks = [];
    for (let index = 0; index < cmapEntries.length; index += 100) {
      const slice = cmapEntries.slice(index, index + 100);
      chunks.push(`${slice.length} beginbfchar\n${slice.join('\n')}\nendbfchar`);
    }
    const toUnicode = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...chunks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
    const fontFileName = `${this.font.name}-Embedded`;
    const safeDate = formatPdfDate(this.createdAt);
    const infoObject = nextObject;
    const objects = new Map();
    objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objects.set(
      2,
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageObjects.map((id) => `${id} 0 R`).join(' ')}] >>`,
    );
    objects.set(3, '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansCJK /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 7 0 R >>');
    objects.set(
      4,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansCJK ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor 5 0 R /DW 1000 /W [${widthEntries.join(' ')}] /CIDToGIDMap /Identity >>`,
    );
    objects.set(
      5,
      `<< /Type /FontDescriptor /FontName /NotoSansCJK /Flags 4 ` +
      `/FontBBox [${this.font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${this.font.ascent} ` +
      `/Descent ${this.font.descent} /CapHeight ${Math.max(0, this.font.ascent)} /StemV 80 ` +
      `/FontFile2 6 0 R >>`,
    );
    objects.set(6, {
      dictionary: `<< /Length ${this.font.data.length} /Length1 ${this.font.data.length} >>`,
      stream: this.font.data,
    });
    objects.set(7, {
      dictionary: `<< /Length ${Buffer.byteLength(toUnicode, 'utf8')} >>`,
      stream: Buffer.from(toUnicode, 'utf8'),
    });

    for (let index = 0; index < this.pages.length; index += 1) {
      const page = this.pages[index];
      const content = Buffer.from(contentStreams[index], 'utf8');
      objects.set(contentObjects[index], {
        dictionary: `<< /Length ${content.length} >>`,
        stream: content,
      });
      objects.set(
        pageObjects[index],
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjects[index]} 0 R >>`,
      );
    }
    objects.set(
      infoObject,
      `<< /Title <${Buffer.from(this.title, 'utf16le').swap16().toString('hex')}> ` +
      `/Author <${Buffer.from(this.author, 'utf16le').swap16().toString('hex')}> /Creator (Tianping System) ` +
      `/CreationDate (${safeDate}) >>`,
    );

    const maxObject = Math.max(...objects.keys());
    const buffers = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    const offsets = new Map();
    let position = buffers[0].length;
    for (let id = 1; id <= maxObject; id += 1) {
      const object = objects.get(id);
      if (object === undefined) {
        const empty = Buffer.from(`${id} 0 obj\n<<>>\nendobj\n`, 'ascii');
        offsets.set(id, position);
        buffers.push(empty);
        position += empty.length;
        continue;
      }
      let buffer;
      if (typeof object === 'string') {
        buffer = Buffer.from(`${id} 0 obj\n${object}\nendobj\n`, 'ascii');
      } else {
        const head = Buffer.from(`${id} 0 obj\n${object.dictionary}\nstream\n`, 'ascii');
        const tail = Buffer.from('\nendstream\nendobj\n', 'ascii');
        buffer = Buffer.concat([head, object.stream, tail]);
      }
      offsets.set(id, position);
      buffers.push(buffer);
      position += buffer.length;
    }

    const xrefPosition = position;
    const xref = [
      'xref',
      `0 ${maxObject + 1}`,
      '0000000000 65535 f ',
      ...Array.from({ length: maxObject }, (_, index) => {
        const id = index + 1;
        return `${String(offsets.get(id)).padStart(10, '0')} 00000 n `;
      }),
      'trailer',
      `<< /Size ${maxObject + 1} /Root 1 0 R /Info ${infoObject} 0 R >>`,
      'startxref',
      String(xrefPosition),
      '%%EOF',
      '',
    ].join('\n');
    buffers.push(Buffer.from(xref, 'ascii'));
    return Buffer.concat(buffers);
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value = new Date()) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatPdfDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mi = pad2(date.getUTCMinutes());
  return `D:${yyyy}${mm}${dd}${hh}${mi}00+00'00'`;
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function normalizeRecordCall(recordOrOptions, deviceOrOptions, options = {}) {
  if (recordOrOptions?.record) {
    return {
      record: recordOrOptions.record,
      device: recordOrOptions.device || deviceOrOptions?.device,
      options: recordOrOptions,
    };
  }
  if (deviceOrOptions?.device && !deviceOrOptions?.points) {
    return {
      record: recordOrOptions,
      device: deviceOrOptions.device,
      options: deviceOrOptions,
    };
  }
  return { record: recordOrOptions, device: deviceOrOptions, options };
}

function recordWatermark(record, options) {
  if (options.watermark === false) return '';
  if (options.watermark) return String(options.watermark);
  return STATUS_WATERMARK[record?.status] || '';
}

function drawWatermark(document, text) {
  if (!text) return;
  const page = document.currentPage;
  document.text(page.width * 0.19, page.height * 0.42, text, {
    size: 64,
    color: [0.88, 0.88, 0.88],
  });
}

function drawCellText(document, x, top, width, height, text, options = {}) {
  document.cell(x, top, width, height, text, options);
}

function drawTitle(document, title, subtitle = '') {
  const page = document.currentPage;
  document.centeredText(42, page.width - 84, page.height - 54, title, {
    size: 17,
    color: [0.08, 0.15, 0.20],
  });
  if (subtitle) {
    document.centeredText(42, page.width - 84, page.height - 72, subtitle, {
      size: 8.5,
      color: [0.34, 0.38, 0.42],
    });
  }
  document.line(42, page.height - 80, page.width - 42, page.height - 80, {
    color: [0.12, 0.32, 0.57],
    width: 1.4,
  });
}

function drawRecordPage(document, record, device, options = {}) {
  document.addPage(options.landscape ? A4_LANDSCAPE.width : A4_PORTRAIT.width,
    options.landscape ? A4_LANDSCAPE.height : A4_PORTRAIT.height);
  const page = document.currentPage;
  const margin = 42;
  const width = page.width - margin * 2;
  const evaluation = evaluateRecord(record, device, options.tolerancePercent);
  const watermark = recordWatermark(record, options);
  drawTitle(document, options.title || '电子天平日常校验记录', `记录编号：${record.id}`);

  let top = 92;
  const labelWidth = 82;
  const valueWidth = 169;
  const rowHeight = 22;
  const grid = [
    [
      ['科室', device.dept],
      ['天平编号', device.id],
      ['天平唯一号', device.uniqueNo],
    ],
    [
      ['Max', `${device.max} g`],
      ['d', `${device.d} mg`],
      ['内部校正方式', device.internalCal],
    ],
    [
      ['校验日期', record.date],
      ['砝码盒编号', record.box],
      ['记录状态', record.status],
    ],
    [
      ['清洁', record.cleanliness],
      ['水平调节', record.level],
      ['内部校正是否通过', record.internalCal],
    ],
  ];
  for (const row of grid) {
    let x = margin;
    for (const [label, value] of row) {
      drawCellText(document, x, top, labelWidth, rowHeight, label, {
        size: 8.3,
        fill: [0.95, 0.96, 0.97],
        align: 'center',
      });
      x += labelWidth;
      drawCellText(document, x, top, valueWidth - labelWidth, rowHeight, safeText(value), {
        size: 8.3,
        align: 'center',
      });
      x += valueWidth - labelWidth;
    }
    top += rowHeight;
  }
  drawCellText(document, margin, top, labelWidth, rowHeight, '备注', {
    size: 8.3,
    fill: [0.95, 0.96, 0.97],
    align: 'center',
  });
  drawCellText(document, margin + labelWidth, top, width - labelWidth, rowHeight, safeText(record.remark, '无'), {
    size: 8.3,
  });
  top += rowHeight + 14;

  const columns = [
    { label: '编号', width: 52, align: 'center' },
    { label: '量程', width: 48, align: 'center' },
    { label: 'L/g', width: 54, align: 'right' },
    { label: '限度/g', width: 130, align: 'center' },
    { label: '示值 I/g', width: 74, align: 'right' },
    { label: '偏差/g', width: 66, align: 'right' },
    { label: '判定', width: 43, align: 'center' },
    { label: options.printTime === false ? '置信度' : '测量时间', width: 86, align: 'center' },
  ];
  const scale = width / columns.reduce((sum, column) => sum + column.width, 0);
  columns.forEach((column) => { column.width *= scale; });

  let x = margin;
  for (const column of columns) {
    drawCellText(document, x, top, column.width, 24, column.label, {
      size: 8,
      align: 'center',
      fill: [0.89, 0.93, 0.97],
    });
    x += column.width;
  }
  top += 24;
  const cellHeight = 20;
  for (const item of evaluation.items) {
    const values = [
      item.key,
      item.rangeLabel,
      formatNumber(item.L, item.dec),
      `${formatNumber(item.lim.lo, item.dec)}~${formatNumber(item.lim.hi, item.dec)}`,
      item.missing ? '缺次' : formatNumber(item.value, item.dec),
      item.missing ? '—' : signedNumber(item.dev, item.dec),
      item.missing || !item.stable ? '不通过' : (item.inLimit ? '在限内' : '超限'),
      options.printTime === false
        ? (item.conf === null ? '—' : item.conf.toFixed(3))
        : safeText(item.time || record.startTime),
    ];
    x = margin;
    values.forEach((value, index) => {
      drawCellText(document, x, top, columns[index].width, cellHeight, value, {
        size: 7.8,
        align: columns[index].align,
        fill: index === 6 && (item.missing || !item.stable || !item.inLimit)
          ? [1, 0.93, 0.93]
          : [1, 1, 1],
      });
      x += columns[index].width;
    });
    top += cellHeight;
  }
  top += 10;

  drawCellText(document, margin, top, 86, 25, '外部校正结论', {
    size: 8.4,
    fill: [0.95, 0.96, 0.97],
    align: 'center',
  });
  drawCellText(document, margin + 86, top, width - 86, 25, evaluation.conclusion, {
    size: 10,
    align: 'center',
    fill: evaluation.pass ? [0.91, 0.97, 0.91] : [1, 0.91, 0.91],
  });
  top += 25;
  const reasonText = evaluation.reasons.length
    ? evaluation.reasons.map((reason) => `${reason.label}：${reason.detail}`).join('\n')
    : judgementBasis(record, device, evaluation);
  const reasonLines = document.wrap(reasonText, width - 16, 8);
  const reasonHeight = Math.max(38, reasonLines.length * 11 + 12);
  drawCellText(document, margin, top, 86, reasonHeight, '判定依据', {
    size: 8.4,
    fill: [0.95, 0.96, 0.97],
    align: 'center',
  });
  drawCellText(document, margin + 86, top, width - 86, reasonHeight, reasonText, {
    size: 8,
  });
  top += reasonHeight + 13;

  drawCellText(document, margin, top, width / 2, 35,
    `校验人员：${options.inspectorName || record.inspector || '—'}\n提交时间：${safeText(formatDateTime(record.submittedAt), '未提交')}`, {
      size: 8.2,
    });
  drawCellText(document, margin + width / 2, top, width / 2, 35,
    `复核确认人：${options.verifierName || record.verifiedBy || '—'}\n复核时间：${safeText(formatDateTime(record.verifiedAt), '未复核')}`, {
      size: 8.2,
    });
  top += 48;

  const footerNote = options.footerNote ||
    '注：出现异常时应在备注栏准确记录，必要时及时报修。';
  document.text(margin, Math.max(44, page.height - top - 26), footerNote, {
    size: 7.8,
    color: [0.32, 0.36, 0.40],
  });
  document.text(margin, Math.max(30, page.height - top - 40),
    `判定式：|I−L| ≤ ${evaluation.tol}%×L；导出时间：${formatDateTime(options.exportedAt || new Date())}`, {
      size: 7.5,
      color: [0.42, 0.46, 0.50],
    });
  drawWatermark(document, watermark);
}

function resolveDeviceForRecord(record, devices) {
  const list = Array.isArray(devices) ? devices : Object.values(devices || {});
  return list.find((device) => String(device?.id) === String(record?.device));
}

/**
 * 生成单条记录 PDF。返回值是 Buffer，错误以中文异常抛出。
 */
export function generateRecordPdf(recordOrOptions, device = null, options = {}) {
  const normalized = normalizeRecordCall(recordOrOptions, device, options);
  if (!normalized.record || !normalized.device) throw new Error('生成 PDF 需要记录和天平档案');
  const exportOptions = {
    ...normalized.options,
    exportedAt: normalized.options.exportedAt || normalized.options.generatedAt,
    printTime: normalized.options.printTime ??
      (normalized.options.template?.printTime !== false),
    footerNote: normalized.options.footerNote ||
      normalized.options.template?.footerNote,
  };
  const document = new PdfDocument({
    title: `天平校验记录 ${normalized.record.id}`,
    createdAt: exportOptions.exportedAt || new Date(),
  });
  drawRecordPage(document, normalized.record, normalized.device, exportOptions);
  return document.finish();
}

export function generateBatchPdf(recordsOrOptions, devices = [], options = {}) {
  const wrapped = Array.isArray(recordsOrOptions) && recordsOrOptions.some((item) => item?.record);
  const config = wrapped
    ? { items: recordsOrOptions, ...devices }
    : Array.isArray(recordsOrOptions)
      ? { records: recordsOrOptions, devices, ...options }
      : recordsOrOptions;
  const records = Array.isArray(config.items)
    ? config.items.map((item) => item.record).filter(Boolean)
    : config.records;
  if (!Array.isArray(config.records) || !config.records.length) {
    if (!Array.isArray(records) || !records.length) {
      throw new Error('批量导出至少需要一条记录');
    }
  }
  const document = new PdfDocument({
    title: `天平校验记录批量导出`,
    createdAt: config.exportedAt || config.generatedAt || new Date(),
  });
  const items = Array.isArray(config.items)
    ? config.items
    : records.map((record) => ({ record }));
  for (const item of items) {
    const record = item.record;
    if (!record) continue;
    const device = item.device || resolveDeviceForRecord(record, config.devices || config.deviceMap);
    if (!device) throw new Error(`记录 ${record.id} 找不到对应天平档案`);
    drawRecordPage(document, record, device, {
      ...config,
      ...item,
      exportedAt: config.exportedAt || config.generatedAt,
      printTime: item.template?.printTime ?? config.printTime,
      footerNote: item.template?.footerNote || config.footerNote,
      inspectorName: config.inspectorNames?.[record.inspector] || item.inspectorName,
      verifierName: config.verifierNames?.[record.verifiedBy] || item.verifierName,
    });
  }
  return document.finish();
}

export function generateWeekPdf(recordsOrOptions, devices = [], options = {}) {
  const wrapped = Array.isArray(recordsOrOptions) && recordsOrOptions.some((item) => item?.record);
  const config = wrapped
    ? { items: recordsOrOptions, ...devices }
    : Array.isArray(recordsOrOptions)
      ? { records: recordsOrOptions, devices, ...options }
      : recordsOrOptions;
  const records = [...(wrapped
    ? config.items.map((item) => item.record).filter(Boolean)
    : (config.records || []))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!records.length) throw new Error('周统计导出至少需要一条记录');
  const document = new PdfDocument({
    title: '天平校验周统计',
    createdAt: config.exportedAt || config.generatedAt || new Date(),
  });
  document.addPage(A4_LANDSCAPE.width, A4_LANDSCAPE.height);
  const page = document.currentPage;
  const margin = 36;
  const width = page.width - margin * 2;
  drawTitle(document, config.title || '每周天平校验统计记录',
    `${config.weekLabel || (config.from && config.to ? `${config.from} ~ ${config.to}` : records[0].date)} · 同一台天平同一自然周`);
  let top = 90;
  const uniqueDates = [...new Set(records.map((record) => record.date))].slice(0, 7);
  const labelWidth = 76;
  const dateWidth = (width - labelWidth) / Math.max(1, uniqueDates.length);
  drawCellText(document, margin, top, labelWidth, 58, '记录日期', {
    size: 8.2,
    align: 'center',
    fill: [0.9, 0.94, 0.98],
  });
  uniqueDates.forEach((date, index) => {
    drawCellText(document, margin + labelWidth + dateWidth * index, top, dateWidth, 58, date, {
      size: 8.4,
      align: 'center',
      fill: [0.9, 0.94, 0.98],
    });
  });
  top += 58;
  const fields = [
    ['砝码盒编号', (record) => record.box],
    ['外部校正', (record) => {
      const device = resolveDeviceForRecord(record, config.devices || config.deviceMap);
      return device ? evaluateRecord(record, device).conclusion : '—';
    }],
    ['L1 示值', (record) => valuesText(record, 0)],
    ['L2 示值', (record) => valuesText(record, 1)],
    ['L3 示值', (record) => valuesText(record, 2)],
    ['校验人员', (record, context) => context.inspectorNames?.[record.inspector] || record.inspector],
    ['复核确认人', (record, context) => context.verifierNames?.[record.verifiedBy] || record.verifiedBy || '—'],
    ['记录状态', (record) => record.status],
  ];
  for (const [label, getter] of fields) {
    drawCellText(document, margin, top, labelWidth, 32, label, {
      size: 7.8,
      align: 'center',
      fill: [0.95, 0.96, 0.97],
    });
    uniqueDates.forEach((date, index) => {
      const candidates = records.filter((record) => record.date === date);
      const record = candidates[0];
      const value = record ? safeText(getter(record, config)) : '';
      drawCellText(document, margin + labelWidth + dateWidth * index, top, dateWidth, 32, value, {
        size: 7.4,
        align: 'center',
      });
    });
    top += 32;
  }
  document.text(margin, 54,
    `导出时间：${formatDateTime(config.exportedAt || config.generatedAt || new Date())}；作废记录不参与统计；同一天多条记录以列表中首条展示。`, {
      size: 7.2,
      color: [0.38, 0.42, 0.46],
    });
  return document.finish();
}

function valuesText(record, point) {
  const values = (record.readouts || [])
    .filter((readout) => Number(readout.point) === point)
    .slice(0, 3)
    .map((readout) => readout.value === null || readout.value === undefined ? '缺次' : String(readout.value));
  return values.length ? values.join(' / ') : '';
}

export function csvEscape(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string') {
    const normalized = text.replace(/^[\u0000-\u0020\uFEFF]+/, '');
    if (/^[=+\-@]/.test(normalized)) text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function generateCsv(rowsOrOptions, columns = null) {
  const config = Array.isArray(rowsOrOptions)
    ? { rows: rowsOrOptions, columns }
    : rowsOrOptions;
  const rows = config?.rows || [];
  let definitions = config?.columns || columns;
  if (!definitions) {
    definitions = Object.keys(rows[0] || {}).map((key) => ({ key, label: key }));
  }
  definitions = definitions.map((column) =>
    typeof column === 'string' ? { key: column, label: column } : column,
  );
  const header = definitions.map((column) => csvEscape(column.label)).join(',');
  const body = rows.map((row) =>
    definitions.map((column) => {
      const value = typeof column.value === 'function' ? column.value(row) : row[column.key];
      return csvEscape(value);
    }).join(','),
  );
  return Buffer.from(`\ufeff${[header, ...body].join('\r\n')}\r\n`, 'utf8');
}

export function generateRecordsCsv(records, devices, names = null) {
  const deviceList = Array.isArray(devices) ? devices : Object.values(devices || {});
  const rows = records.map((record) => {
    const device = deviceList.find((item) => String(item.id) === String(record.device));
    const evaluation = device ? evaluateRecord(record, device) : null;
    return {
      recordId: record.id,
      date: record.date,
      device: record.device,
      uniqueNo: device?.uniqueNo || '',
      box: record.box,
      inspector: names?.[record.inspector] || record.inspector,
      conclusion: evaluation?.conclusion || '',
      status: record.status,
      submittedAt: record.submittedAt || '',
      verifiedBy: names?.[record.verifiedBy] || record.verifiedBy || '',
      verifiedAt: record.verifiedAt || '',
      remark: record.remark || '',
    };
  });
  return generateCsv({
    rows,
    columns: [
      { key: 'recordId', label: '记录编号' },
      { key: 'date', label: '校验日期' },
      { key: 'device', label: '天平编号' },
      { key: 'uniqueNo', label: '天平唯一号' },
      { key: 'box', label: '砝码盒编号' },
      { key: 'inspector', label: '检验人员' },
      { key: 'conclusion', label: '判定结论' },
      { key: 'status', label: '复核状态' },
      { key: 'submittedAt', label: '提交时间' },
      { key: 'verifiedBy', label: '复核确认人' },
      { key: 'verifiedAt', label: '复核时间' },
      { key: 'remark', label: '备注' },
    ],
  });
}

export function generateReadoutSummaryCsv(records, devices) {
  const deviceList = Array.isArray(devices) ? devices : Object.values(devices || {});
  const rows = [];
  for (const record of records) {
    const device = deviceList.find((item) => String(item.id) === String(record.device));
    if (!device) continue;
    const evaluation = evaluateRecord(record, device);
    for (const item of evaluation.items) {
      rows.push({
        date: record.date,
        recordId: record.id,
        device: record.device,
        key: item.key,
        range: item.rangeLabel,
        nominal: item.L,
        limitLo: item.lim.lo,
        limitHi: item.lim.hi,
        value: item.value ?? '',
        deviation: item.dev ?? '',
        inLimit: item.inLimit ? '是' : '否',
        stable: item.stable ? '是' : '否',
        confidence: item.conf ?? '',
        conclusion: evaluation.conclusion,
      });
    }
  }
  return generateCsv({ rows });
}

export function getPdfExportStatus() {
  try {
    const font = loadFont();
    return {
      available: true,
      font: font.path,
      fontBytes: font.size,
      engine: 'built-in-cjk-pdf',
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      engine: 'built-in-cjk-pdf',
    };
  }
}

export const exportRecordPdf = generateRecordPdf;
export const exportBatchPdf = generateBatchPdf;
export const exportWeekPdf = generateWeekPdf;
export const exportCsv = generateCsv;

export default {
  generateRecordPdf,
  generateBatchPdf,
  generateWeekPdf,
  generateCsv,
  generateRecordsCsv,
  generateReadoutSummaryCsv,
  getPdfExportStatus,
};
