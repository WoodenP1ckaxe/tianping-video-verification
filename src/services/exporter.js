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

const TEMPLATE_FIELD_DEFAULTS = Object.freeze({
  dept: '科室',
  uniqueNo: '天平唯一号',
  max: 'Max(g)',
  d: 'd(mg)',
  internalCalType: '内部校正方式',
  date: '校验日期',
  cleanliness: '清洁',
  level: '水平调节',
  internalCal: '内部校正是否通过',
  remark: '备注',
  box: '砝码盒编号',
  time: '测量时间',
  detail: '判定结论明细',
});

function templateField(template, key) {
  const configured = Array.isArray(template?.fields)
    ? template.fields.find((field) => field?.key === key)
    : null;
  return {
    key,
    label: String(configured?.label || TEMPLATE_FIELD_DEFAULTS[key] || key),
    show: configured?.show !== false,
    locked: configured?.locked === true,
  };
}

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
    this.pageIndex = -1;
    this.usedGlyphs = new Map();
    this.title = options.title || '天平校验记录';
    this.author = options.author || '天平校验视频分析系统';
    this.createdAt = options.createdAt || new Date();
  }

  addPage(width = A4_PORTRAIT.width, height = A4_PORTRAIT.height) {
    this.pages.push({ width, height, commands: [] });
    this.pageIndex = this.pages.length - 1;
    return this.pages.length - 1;
  }

  get currentPage() {
    return this.pages[this.pageIndex] || null;
  }

  selectPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.pages.length) {
      throw new RangeError('PDF 页码无效');
    }
    this.pageIndex = index;
    return this.currentPage;
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
      `<< /Title <${pdfUnicodeHex(this.title)}> ` +
      `/Author <${pdfUnicodeHex(this.author)}> /Creator (Tianping System) ` +
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

function pdfUnicodeHex(value) {
  const body = Buffer.from(String(value ?? ''), 'utf16le').swap16().toString('hex');
  return `FEFF${body.toUpperCase()}`;
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function formatVideoOffset(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
    document.centeredText(42, page.width - 84, page.height - 70, subtitle, {
      size: 8.5,
      color: [0.34, 0.38, 0.42],
    });
  }
  document.line(42, page.height - 84, page.width - 42, page.height - 84, {
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
  const template = options.template || {};
  const fieldDefinitions = {
    dept: device.dept,
    uniqueNo: device.uniqueNo,
    max: `${device.max} g`,
    d: `${device.d} mg`,
    internalCalType: device.internalCal,
    date: record.date,
    cleanliness: record.cleanliness,
    level: record.level,
    internalCal: record.internalCal,
    box: record.box,
  };
  const visibleFields = [
    'dept', 'uniqueNo', 'max', 'd', 'internalCalType',
    'date', 'cleanliness', 'level', 'internalCal', 'box',
  ].map((key) => ({
    ...templateField(template, key),
    value: fieldDefinitions[key],
  })).filter((field) => field.show);
  visibleFields.unshift({
    key: 'id',
    label: '天平编号',
    show: true,
    value: device.id,
  });
  const grid = [];
  for (let index = 0; index < visibleFields.length; index += 3) {
    const row = visibleFields.slice(index, index + 3).map((field) => [
      field.label,
      field.value,
    ]);
    grid.push(row);
  }
  const remarkField = templateField(template, 'remark');
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
  const configuredPoints = Array.isArray(template.points) && template.points.length === 3
    ? template.points
    : device.points;
  if (Array.isArray(configuredPoints) && configuredPoints.length === 3) {
    drawCellText(document, margin, top, labelWidth, rowHeight, '模板标称点', {
      size: 8.3,
      fill: [0.95, 0.96, 0.97],
      align: 'center',
    });
    drawCellText(
      document,
      margin + labelWidth,
      top,
      width - labelWidth,
      rowHeight,
      configuredPoints.map((point, index) => `L${index + 1}=${point}g`).join(' · '),
      { size: 8.3 },
    );
    top += rowHeight;
  }
  if (Number(device.ranges) === 2) {
    const transition = record.rangeTransition || {};
    const transitionText = transition.endOffsetSeconds !== undefined
      ? `高量程 → 低量程；过程段 ${formatVideoOffset(transition.startOffsetSeconds)} ～ ${formatVideoOffset(transition.endOffsetSeconds)}`
      : '未识别到完整量程切换过程段';
    drawCellText(document, margin, top, labelWidth, rowHeight, '量程切换过程', {
      size: 8.3,
      fill: [0.95, 0.96, 0.97],
      align: 'center',
    });
    drawCellText(document, margin + labelWidth, top, width - labelWidth, rowHeight, transitionText, {
      size: 8.3,
    });
    top += rowHeight;
  }
  if (remarkField.show) {
    drawCellText(document, margin, top, labelWidth, rowHeight, remarkField.label, {
      size: 8.3,
      fill: [0.95, 0.96, 0.97],
      align: 'center',
    });
    drawCellText(document, margin + labelWidth, top, width - labelWidth, rowHeight, safeText(record.remark, '无'), {
      size: 8.3,
    });
    top += rowHeight;
  }
  top += 14;

  const timeField = templateField(template, 'time');
  const showTime = options.printTime !== false && timeField.show;
  const columns = [
    { label: '编号', width: 52, align: 'center' },
    { label: '量程', width: 48, align: 'center' },
    { label: 'L/g', width: 54, align: 'right' },
    { label: '限度/g', width: 130, align: 'center' },
    { label: '示值 I/g', width: 74, align: 'right' },
    { label: '偏差/g', width: 66, align: 'right' },
    { label: '判定', width: 43, align: 'center' },
    { label: showTime ? timeField.label : '置信度', width: 86, align: 'center' },
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
      showTime
        ? safeText(item.time || record.startTime)
        : (item.conf === null ? '—' : item.conf.toFixed(3)),
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
  const detailField = templateField(template, 'detail');
  if (detailField.show) {
    const reasonText = evaluation.reasons.length
      ? evaluation.reasons.map((reason) => `${reason.label}：${reason.detail}`).join('\n')
      : judgementBasis(record, device, evaluation);
    const reasonLines = document.wrap(reasonText, width - 16, 8);
    const reasonHeight = Math.max(38, reasonLines.length * 11 + 12);
    drawCellText(document, margin, top, 86, reasonHeight, detailField.label, {
      size: 8.4,
      fill: [0.95, 0.96, 0.97],
      align: 'center',
    });
    drawCellText(document, margin + 86, top, width - 86, reasonHeight, reasonText, {
      size: 8,
    });
    top += reasonHeight + 13;
  }

  drawCellText(document, margin, top, width / 2, 35,
    `校验人员：${options.inspectorName || record.inspector || '—'}\n提交时间：${safeText(formatDateTime(record.submittedAt), '未提交')}`, {
      size: 8.2,
    });
  drawCellText(document, margin + width / 2, top, width / 2, 35,
    `复核确认人：${options.verifierName || record.verifiedBy || '—'}\n复核时间：${safeText(formatDateTime(record.verifiedAt), '未复核')}`, {
      size: 8.2,
    });
  top += 48;

  const footerNote = [
    options.footerNote || '注：出现异常时应在备注栏准确记录，必要时及时报修。',
    options.footerExtra
  ].filter(Boolean).join('\n');
  document.text(margin, Math.max(44, page.height - top - 34), footerNote, {
    size: 7.8,
    color: [0.32, 0.36, 0.40],
  });
  document.text(margin, Math.max(28, page.height - top - 54),
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
    footerExtra: normalized.options.footerExtra ||
      normalized.options.template?.footerExtra,
    template: normalized.options.template,
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
      footerExtra: item.template?.footerExtra || config.footerExtra,
      template: item.template || config.template,
      inspectorName: config.inspectorNames?.[record.inspector] || item.inspectorName,
      verifierName: config.verifierNames?.[record.verifiedBy] || item.verifierName,
    });
  }
  return document.finish();
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xFFFFFFFF;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  }
  return (value ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 将多个本地 PDF 打包为 ZIP。采用 store 模式，不引入外部压缩依赖。
 */
export function generateZip(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('ZIP 文件包至少需要一个文件');
  const entries = files.map((file) => {
    const name = String(file.name || '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!name || name.includes('../')) throw new Error('ZIP 文件名无效');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || []);
    return { name: Buffer.from(name, 'utf8'), data, crc: crc32(data) };
  });
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, entry.name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, entry.name);
    offset += local.length + entry.name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
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
  const weekDevice = config.device
    || records.map((record) => resolveDeviceForRecord(
      record,
      config.devices || config.deviceMap
    )).find(Boolean);
  drawTitle(document, config.title || '每周天平校验统计记录',
    `${config.weekLabel || (config.from && config.to ? `${config.from} ~ ${config.to}` : records[0].date)} · ` +
    `${weekDevice?.dept || '—'} · ${weekDevice?.id || records[0].device} · ` +
    `Max ${safeText(weekDevice?.max)} g / d ${safeText(weekDevice?.d)} mg`);
  let top = 90;
  const uniqueDates = [...new Set(records.map((record) => record.date))].slice(0, 7);
  const labelWidth = 76;
  const dateWidth = (width - labelWidth) / Math.max(1, uniqueDates.length);
  drawCellText(document, margin, top, labelWidth, 44, '记录日期', {
    size: 8.2,
    align: 'center',
    fill: [0.9, 0.94, 0.98],
  });
  uniqueDates.forEach((date, index) => {
    drawCellText(document, margin + labelWidth + dateWidth * index, top, dateWidth, 44, date, {
      size: 8.4,
      align: 'center',
      fill: [0.9, 0.94, 0.98],
    });
  });
  top += 44;
  const fields = [
    ['清洁 / 水平 / 内部校正', (record) => (
      `清洁：${safeText(record.cleanliness)}\n水平：${safeText(record.level)}\n内部校正：${safeText(record.internalCal)}`
    ), 36],
    ['砝码盒 / 外部校正', (record) => {
      const device = resolveDeviceForRecord(record, config.devices || config.deviceMap);
      return `砝码盒：${safeText(record.box)}\n外部校正：${device ? evaluateRecord(record, device).conclusion : '—'}`;
    }, 30],
    ...[0, 1, 2].map((point) => [
      `L${point + 1} 限度 / 示值 / 时间`,
      (record) => {
        const device = resolveDeviceForRecord(record, config.devices || config.deviceMap);
        const evaluation = device ? evaluateRecord(record, device) : null;
        const items = evaluation?.items?.filter((item) => Number(item.point) === point) || [];
        const limit = items[0]
          ? `L=${safeText(items[0].L, '—')} g；限度 ${safeText(items[0].lim?.lo)}～${safeText(items[0].lim?.hi)} g`
          : 'L=—；限度 —';
        const readings = items.length
          ? items.map((item) => safeText(item.value)).join(' / ')
          : valuesText(record, point);
        const times = items.length
          ? items.map((item) => safeText(item.time)).join(' / ')
          : '—';
        return `${limit}\n示值：${readings}\n时间：${times}`;
      },
      52,
    ]),
    ['备注', (record) => safeText(record.remark), 30],
    ['人员 / 状态', (record, context) => (
      `校验：${context.inspectorNames?.[record.inspector] || record.inspector}\n` +
      `复核：${context.verifierNames?.[record.verifiedBy] || record.verifiedBy || '—'}\n` +
      `状态：${record.status}`
    ), 34],
  ];
  for (const [label, getter, rowHeight = 30] of fields) {
    drawCellText(document, margin, top, labelWidth, rowHeight, label, {
      size: 7.8,
      align: 'center',
      fill: [0.95, 0.96, 0.97],
    });
    uniqueDates.forEach((date, index) => {
      const candidates = records.filter((record) => record.date === date);
      const value = candidates.length
        ? candidates.map((record) => safeText(getter(record, config))).join(' / ')
        : '';
      drawCellText(document, margin + labelWidth + dateWidth * index, top, dateWidth, rowHeight, value, {
        size: 6.9,
        align: 'center',
      });
    });
    top += rowHeight;
  }
  document.text(margin, 42,
    `导出时间：${formatDateTime(config.exportedAt || config.generatedAt || new Date())}；仅统计已复核确认且未作废记录；同一天多条记录并列展示。`, {
      size: 7.2,
      color: [0.38, 0.42, 0.46],
    });
  return document.finish();
}

/**
 * 生成可直接打印的空白校验记录表。空白表不包含二维码或人员/设备清单，
 * 避免操作人员把辅助卡片当作正式表格内容。
 */
export function generateBlankFormPdf(options = {}) {
  const document = new PdfDocument({
    title: '电子天平日常校验空白记录',
    createdAt: options.exportedAt || options.generatedAt || new Date(),
  });
  document.addPage(A4_PORTRAIT.width, A4_PORTRAIT.height);
  const page = document.currentPage;
  const margin = 42;
  const width = page.width - margin * 2;
  drawTitle(document, '电子天平日常校验记录表', '空白记录表 · 打印后填写并随电子记录留档');
  let top = 94;
  const labelWidth = 82;
  const valueWidth = (width - labelWidth * 3) / 3;
  const metaRows = [
    [
      ['科室', ''],
      ['天平编号', ''],
      ['天平唯一号', ''],
    ],
    [
      ['Max(g)', ''],
      ['d(mg)', ''],
      ['内部校正方式', '□自动  □手动  □NA'],
    ],
    [
      ['校验日期', ''],
      ['砝码盒编号', ''],
      ['模板版本', options.templateVersion || 'v1'],
    ],
    [
      ['清洁', '□是  □否  □NA'],
      ['水平调节', '□是  □否  □NA'],
      ['内部校正通过', '□是  □否  □NA'],
    ],
  ];
  for (const row of metaRows) {
    row.forEach(([label, value], index) => {
      drawCellText(document, margin + index * (labelWidth + valueWidth), top, labelWidth, 27, label, {
        size: 7.7,
        align: 'center',
        fill: [0.94, 0.96, 0.97],
      });
      drawCellText(
        document,
        margin + index * (labelWidth + valueWidth) + labelWidth,
        top,
        valueWidth,
        27,
        value,
        { size: 8.2, align: 'center' },
      );
    });
    top += 27;
  }
  drawCellText(document, margin, top, labelWidth, 42, '备注', {
    size: 7.7,
    align: 'center',
    fill: [0.94, 0.96, 0.97],
  });
  drawCellText(document, margin + labelWidth, top, width - labelWidth, 42, '', {
    size: 8,
  });
  top += 42;

  const columns = [
    ['标称点', 60],
    ['标称值 L(g)', 62],
    ['限度区间(g)', 112],
    ['第 1 次 I(g)', 72],
    ['第 2 次 I(g)', 72],
    ['第 3 次 I(g)', 72],
    ['测量时间', 70],
  ];
  const totalColumnWidth = columns.reduce((sum, [, columnWidth]) => sum + columnWidth, 0);
  const scale = width / totalColumnWidth;
  columns.forEach(([label, columnWidth], index) => {
    const x = margin + columns.slice(0, index).reduce((sum, [, value]) => sum + value * scale, 0);
    drawCellText(document, x, top, columnWidth * scale, 30, label, {
      size: 7.5,
      align: 'center',
      fill: [0.9, 0.94, 0.98],
    });
  });
  top += 30;
  for (let point = 0; point < 3; point += 1) {
    columns.forEach(([, columnWidth], index) => {
      const x = margin + columns.slice(0, index).reduce((sum, [, value]) => sum + value * scale, 0);
      const text = index === 0 ? `L${point + 1}` : '';
      drawCellText(document, x, top, columnWidth * scale, 54, text, {
        size: 8,
        align: 'center',
        fill: index === 0 ? [0.96, 0.97, 0.98] : [1, 1, 1],
      });
    });
    top += 54;
  }

  top += 14;
  const signatureBlockWidth = width / 2;
  drawCellText(document, margin, top, labelWidth, 54, '校验人员签名\n/ 日期', {
    size: 7.8,
    align: 'center',
    fill: [0.94, 0.96, 0.97],
  });
  drawCellText(document, margin + labelWidth, top, signatureBlockWidth - labelWidth, 54, '', {
    size: 8,
  });
  drawCellText(document, margin + signatureBlockWidth, top, labelWidth, 54, '复核确认人签名\n/ 日期', {
    size: 7.8,
    align: 'center',
    fill: [0.94, 0.96, 0.97],
  });
  drawCellText(
    document,
    margin + signatureBlockWidth + labelWidth,
    top,
    signatureBlockWidth - labelWidth,
    54,
    '',
    { size: 8 },
  );
  top += 65;

  document.text(margin, page.height - top, '说明：九次称量应完整填写；判定和电子签名以系统记录为准。', {
    size: 8,
    color: [0.36, 0.42, 0.46],
  });
  return document.finish();
}

/**
 * 生成面向最终用户的标准操作流程 PDF。内容使用简短步骤和角色清单，
 * 避免操作人员必须阅读技术架构文档。
 */
export function generateSopPdf(options = {}) {
  const document = new PdfDocument({
    title: '天平校验视频分析系统标准操作流程',
    author: '天平校验视频分析系统',
    createdAt: options.exportedAt || new Date(),
  });
  const margin = 48;
  const width = A4_PORTRAIT.width - margin * 2;

  const startPage = (section = '') => {
    document.addPage();
    const page = document.currentPage;
    const top = page.height - 42;
    document.text(margin, top, '天平校验视频分析系统', {
      size: 8.5,
      color: [0.38, 0.45, 0.5],
    });
    if (section) {
      document.centeredText(margin, width, top, section, {
        size: 8.5,
        color: [0.38, 0.45, 0.5],
      });
    }
    document.line(margin, page.height - 54, page.width - margin, page.height - 54, {
      width: 0.7,
      color: [0.55, 0.62, 0.67],
    });
    return { top: 74, section };
  };

  let layout = startPage('使用说明');
  const ensure = (height) => {
    if (layout.top + height <= document.currentPage.height - 54) return;
    const section = layout.section;
    layout = startPage(section);
  };
  const heading = (text, level = 1) => {
    const size = level === 1 ? 17 : 12;
    const height = level === 1 ? 34 : 25;
    ensure(height);
    if (level > 1) layout.top += 4;
    if (level === 1) {
      document.rect(margin, document.currentPage.height - layout.top - 23, 4, 21, {
        fill: [0.05, 0.52, 0.47],
        stroke: false,
      });
      document.text(margin + 12, document.currentPage.height - layout.top - 17, text, {
        size,
        color: [0.07, 0.18, 0.27],
      });
    } else {
      document.text(margin, document.currentPage.height - layout.top - 12, text, {
        size,
        color: [0.08, 0.35, 0.49],
      });
    }
    layout.top += height;
  };
  const paragraph = (text, style = {}) => {
    const size = style.size || 9.4;
    const indent = style.indent || 0;
    const lines = document.wrap(text, width - indent, size);
    const lineHeight = size * 1.62;
    for (const line of lines) {
      ensure(lineHeight + 3);
      const baseline = document.currentPage.height - layout.top - size;
      document.text(margin + indent, baseline, line, {
        size,
        color: style.color || [0.17, 0.24, 0.29],
      });
      layout.top += lineHeight;
    }
  };
  const bullet = (text) => {
    ensure(24);
    document.text(margin + 4, document.currentPage.height - layout.top - 9.4, '•', {
      size: 10,
      color: [0.04, 0.53, 0.47],
    });
    paragraph(text, { indent: 18, size: 9.2 });
  };
  const note = (text, color = [0.1, 0.35, 0.45]) => {
    const lines = document.wrap(text, width - 24, 8.8);
    const height = lines.length * 14 + 20;
    ensure(height);
    const y = document.currentPage.height - layout.top - height;
    document.rect(margin, y, width, height, {
      fill: [0.93, 0.97, 0.98],
      stroke: [0.73, 0.83, 0.87],
    });
    lines.forEach((line, index) => {
      document.text(margin + 12, y + height - 19 - index * 14, line, {
        size: 8.8,
        color,
      });
    });
    layout.top += height + 10;
  };

  // Cover area on first page.
  document.rect(margin, 580, width, 222, {
    fill: [0.035, 0.17, 0.27],
    stroke: false,
  });
  document.text(margin + 22, 752, '天平校验视频分析系统', {
    size: 22,
    color: [0.95, 0.99, 1],
  });
  document.text(margin + 22, 718, '标准操作流程', {
    size: 30,
    color: [0.38, 0.86, 0.78],
  });
  document.text(margin + 22, 683, 'STANDARD OPERATING PROCEDURE', {
    size: 9,
    color: [0.67, 0.79, 0.86],
  });
  document.text(margin + 22, 655, `版本 1.1 · ${formatDateTime(options.exportedAt || new Date()).slice(0, 10)}`, {
    size: 8.5,
    color: [0.67, 0.79, 0.86],
  });
  layout.top = 300;
  heading('目的与适用范围', 1);
  paragraph('本流程用于指导检验人员、复核确认人员和管理员完成电子天平日常校验视频的拍摄、上传、自动分析、人工核对、电子确认、复核与归档。系统以本地视觉识别为主，不使用语音识别。');
  note('最重要的原则：正式记录必须同时具备唯一人员身份、唯一设备身份、九次可核验读数及其真实视频帧证据。');
  heading('开始前准备', 2);
  bullet('确认浏览器可访问内网系统地址，屏幕分辨率建议不低于 1280 × 720。');
  bullet('按现场要求安装固定支架，确保天平显示屏、称重区域和二维码卡片清晰可见。');
  bullet('设备二维码打印后长期固定在天平正面或侧面；人员二维码由本人妥善保存，不得转借。');
  bullet('天平先完成必要清洁和水平调节，并确认砝码盒编号。');

  const page2 = startPage('标准流程');
  layout = page2;
  heading('七步完成一次校验', 1);
  const steps = [
    ['1. 出示身份卡', '开始拍摄后先出示本人人员卡至少 2 秒。设备卡已长期贴在设备上时可同时出现在同一画面。'],
    ['2. 拍摄九次称量', '按 L1 三次、L2 三次、L3 称量完成九次读数。每次示值稳定停留至少 3 秒，镜头不要晃动或遮挡。'],
    ['3. 上传视频', '进入“上传校验视频”，确认文件、大小与拍摄开始时间。支持 MP4 / MOV，单个文件不超过 500 MB。'],
    ['4. 等待自动分析', '任务按上传顺序串行处理。完成后可从“我的分析任务”打开记录；失败时阅读任务原因，不要重复提交同一视频。'],
    ['5. 核对识别结果', '逐项查看读数值、识别帧、时间、置信度和异常提示。发现识别错误时修正并填写理由。'],
    ['6. 人工观察确认', '根据现场实际观察选择“清洁”“水平调节”“内部校正是否通过”，填写砝码盒编号和备注。'],
    ['7. 提交、复核与归档', '提交即形成电子签名。复核确认人员检查证据后确认或退回；确认后的正式 PDF 用于打印留档。'],
  ];
  for (const [title, text] of steps) {
    heading(title, 2);
    paragraph(text);
  }
  note('不通过记录同样必须提交并复核，作为异常记录归档。不得通过修改结论绕过规则；只能修正确有错误的识别读数并让系统重新判定。');

  layout = startPage('角色操作');
  heading('检验人员', 1);
  bullet('只上传本人完成的校验；视频中的人员卡必须与当前登录账号一致。');
  bullet('双量程天平先完成高量程三次，再切换量程完成低量程六次。');
  bullet('处理全部低置信、缺次、不稳定提示后再提交；每个有效读数必须保留真实识别帧。');
  bullet('在“校验记录”选择天平查看历史汇总、示值明细和自动放大的误差曲线。');
  heading('复核确认人员', 1);
  bullet('核对视频、九次识别帧、限值、偏差、判定原因和修改前后值。');
  bullet('确认即电子签名并锁定记录；退回时必须写明需要修改的内容。');
  bullet('维护天平、砝码盒和记录模板。模板修改只影响之后新建的记录。');
  bullet('复核角色没有个人二维码；设备卡仍可按天平编号查询和补打。');
  heading('系统管理员', 1);
  bullet('管理账号、角色、天平档案、模板、分析队列、备份、容量和审计日志。');
  bullet('在运行状态页按“每台在用天平每天 1 次记录”查看容量和预计存储时长。');
  bullet('账号口令允许无限次重试；错误达到 5 次后，后续每次登录必须输入验证码。');
  bullet('组织操作培训，并将本流程 PDF 提供给全部使用人员。');

  layout = startPage('二维码、统计与问题处理');
  heading('二维码使用要求', 1);
  bullet('人员卡：仅检验人员进入“二维码”，下载本人 SVG 或 PNG 卡片并打印。复核确认人员没有个人二维码。');
  bullet('设备卡：由检验人员查询后导出，贴在天平正面或侧面。设备卡可以长期出现在视频中。');
  bullet('人员卡与设备卡同屏是允许的。分析器支持同帧多二维码检测，并会跨多个抽样帧合并身份。');
  bullet('避免反光、折痕和遮挡；二维码本体建议不小于 40 mm × 40 mm，纠错等级为 H。');
  heading('周统计表导出', 1);
  paragraph('进入“导出与打印”，在周统计表中选择一台天平和“校验周”。系统自动换算为周一至周日，并导出同一自然周的 A4 横向 PDF。若所选周没有已复核记录，系统会明确提示。');
  heading('曲线图阅读', 1);
  paragraph('历史页将 L1、L2、L3 分别绘制为“示值误差（mg）”曲线。纵轴按当前数据自动缩放，零线表示标称值；小圆点表示每组三次称量，折线表示均值。不要将不同量程或不同标称点的曲线直接叠加比较。');
  heading('常见问题', 1);
  bullet('提示人员卡或设备卡无效：检查卡片是否清晰、是否与登录人员/天平档案一致，必要时重新打印并补拍。');
  bullet('任务提示待人工处理：查看错误原因。管理员只能在核实原始视频后执行人工补录，并保留补录理由。');
  bullet('PDF 无法下载：确认浏览器允许下载，当前账号具备导出权限，且所选日期范围内存在符合状态要求的记录。');
  bullet('存储预计时长不足：管理员可在运行状态页查看平均视频大小、每日预计新增和限制因素，再决定扩容或清理策略。');
  note('技术支持：请提供任务编号、记录编号、操作时间和页面提示。不要通过聊天或邮件发送含口令、人员敏感信息或原始视频的截图。');

  const totalPages = document.pages.length;
  document.pages.forEach((page, index) => {
    document.selectPage(index);
    document.line(margin, 34, page.width - margin, 34, {
      width: 0.45,
      color: [0.74, 0.8, 0.83],
    });
    document.text(margin, 21, '天平校验视频分析系统 · 标准操作流程', {
      size: 7.2,
      color: [0.45, 0.52, 0.56],
    });
    document.centeredText(margin, width, 21, `第 ${index + 1} 页 / 共 ${totalPages} 页`, {
      size: 7.2,
      color: [0.45, 0.52, 0.56],
    });
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
export const exportBlankFormPdf = generateBlankFormPdf;
export const exportSopPdf = generateSopPdf;
export const exportCsv = generateCsv;

export default {
  generateRecordPdf,
  generateBatchPdf,
  generateWeekPdf,
  generateBlankFormPdf,
  generateSopPdf,
  generateCsv,
  generateRecordsCsv,
  generateReadoutSummaryCsv,
  getPdfExportStatus,
};
