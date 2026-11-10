import test from 'node:test';
import assert from 'node:assert/strict';
import {
  csvEscape,
  generateBatchPdf,
  generateBlankFormPdf,
  generateCsv,
  generateRecordPdf,
  generateRecordsCsv,
  generateSopPdf,
  generateWeekPdf,
  generateZip,
  getPdfExportStatus,
} from '../src/services/exporter.js';

test('CSV 单元格阻止电子表格公式注入', () => {
  assert.equal(csvEscape('=HYPERLINK("payload")'), '"\'=HYPERLINK(""payload"")"');
  assert.equal(csvEscape('  +cmd'), '"\'  +cmd"');
  assert.equal(csvEscape('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  assert.equal(csvEscape(-1), '"-1"');
  assert.equal(csvEscape('普通文本'), '"普通文本"');
});

const device = {
  id: 'F001',
  uniqueNo: 'DZTP170911C',
  dept: '化学室',
  max: 220,
  d: 0.1,
  ranges: 1,
  range1: { max: 220, d: 0.1 },
  range2: null,
  internalCal: '手动触发',
  points: [200, 50, 10],
  pointRange: [1, 1, 1],
  tol: 0.05,
};

const values = [200.0062, 200.0031, 199.9987, 50.0002, 49.9988, 50.0011, 10.0001, 9.9994, 10.0006];

function makeRecord(id = '20260928-F001-01', status = '已复核确认', date = '2026-09-28') {
  return {
    id,
    date,
    device: 'F001',
    inspector: 'U001',
    box: 'FM2512920',
    startTime: `${date} 08:31`,
    status,
    cleanliness: '是',
    level: '是',
    internalCal: '是',
    remark: '无',
    rangeSwitch: true,
    readouts: values.map((value, index) => ({
      point: Math.floor(index / 3),
      idx: (index % 3) + 1,
      value,
      unit: 'g',
      off: 30 + index * 35,
      time: `${date} 08:${String(32 + index).padStart(2, '0')}`,
      conf: 0.995,
      stable: true,
      range: 1,
    })),
    submittedAt: `${date} 08:52`,
    verifiedBy: 'U003',
    verifiedAt: `${date} 09:14`,
  };
}

test('中文字体 PDF 引擎可离线加载', () => {
  const status = getPdfExportStatus();
  assert.equal(status.available, true, status.error);
  assert.match(status.font, /(Noto|Deng|simhei|wqy|unifont)/i);
});

test('单条记录生成有效 PDF 容器和中文嵌入字体', () => {
  const buffer = generateRecordPdf(makeRecord(), device, {
    inspectorName: '李一',
    verifierName: '齐一',
  });
  const text = buffer.toString('latin1');
  assert.equal(text.startsWith('%PDF-1.7'), true);
  assert.equal(text.includes('/Type /Font'), true);
  assert.equal(text.includes('/FontFile2'), true);
  assert.equal(text.includes('%%EOF'), true);
  assert.ok(buffer.length > 100_000);
});

test('未复核和已作废记录带对应水印', () => {
  const unverified = generateRecordPdf(makeRecord('20260928-F001-02', '待提交'), device);
  const voided = generateRecordPdf(makeRecord('20260928-F001-03', '已作废'), device);
  assert.ok(unverified.length > 0);
  assert.ok(voided.length > 0);
});

test('批量 PDF 为每条记录增加独立页面', () => {
  const records = [
    makeRecord('20260927-F001-01', '已复核确认', '2026-09-27'),
    makeRecord('20260928-F001-01', '已复核确认', '2026-09-28'),
  ];
  const buffer = generateBatchPdf({ records, devices: [device], exportedAt: new Date() });
  assert.equal(buffer.toString('latin1').includes('/Count 2'), true);
});

test('分文件导出的 ZIP 使用可校验的本地文件容器', () => {
  const zip = generateZip([
    { name: '天平校验记录_F001_20260928.pdf', data: Buffer.from('%PDF-1.7\nfirst') },
    { name: '天平校验记录_F002_20260928.pdf', data: Buffer.from('%PDF-1.7\nsecond') },
  ]);
  assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304');
  assert.match(zip.toString('utf8'), /天平校验记录_F001_20260928\.pdf/);
  assert.match(zip.toString('utf8'), /天平校验记录_F002_20260928\.pdf/);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054B50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
});

test('PDF 使用历史模板快照的字段、标称点和页脚配置', () => {
  const template = {
    version: 'v9',
    tol: 0.05,
    printTime: false,
    points: [201, 51, 11],
    footerNote: '客户确认页脚',
    footerExtra: '客户确认判定说明',
    fields: [
      { key: 'dept', label: '使用科室', show: true, locked: true },
      { key: 'uniqueNo', label: '设备唯一号', show: true, locked: true },
      { key: 'remark', label: '补充说明', show: false, locked: false },
      { key: 'time', label: '记录时刻', show: false, locked: false },
      { key: 'detail', label: '判定明细', show: true, locked: false },
    ],
  };
  const pdf = generateRecordPdf(makeRecord(), device, { template });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.7');
  assert.ok(pdf.length > 100_000);
});

test('导出函数兼容后端传入设备包装对象', () => {
  const record = makeRecord();
  const single = generateRecordPdf(record, {
    device,
    template: { printTime: true },
    watermark: '',
    generatedAt: '2026-10-26 10:00',
  });
  assert.equal(single.subarray(0, 8).toString(), '%PDF-1.7');

  const batch = generateBatchPdf([
    { record, device },
    { record: makeRecord('20260927-F001-01', '已复核确认', '2026-09-27'), device },
  ], { generatedAt: '2026-10-26 10:00' });
  assert.equal(batch.toString('latin1').includes('/Count 2'), true);

  const week = generateWeekPdf([
    { record, device },
    { record: makeRecord('20260927-F001-01', '已复核确认', '2026-09-27'), device },
  ], { device, from: '2026-09-21', to: '2026-09-27' });
  assert.equal(week.subarray(0, 8).toString(), '%PDF-1.7');
});

test('周统计 PDF 使用 A4 横向页面', () => {
  const records = [
    makeRecord('20260921-F001-01', '已复核确认', '2026-09-21'),
    makeRecord('20260922-F001-01', '已复核确认', '2026-09-22'),
  ];
  const buffer = generateWeekPdf({ records, devices: [device], weekLabel: '2026-09-21 ~ 2026-09-27' });
  assert.equal(buffer.toString('latin1').includes('/MediaBox [0 0 841.89 595.28]'), true);
});

test('空白记录表生成单页 A4 可打印 PDF', () => {
  const buffer = generateBlankFormPdf({ exportedAt: '2026-11-08 12:00' });
  const pdf = buffer.toString('latin1');
  assert.equal(pdf.includes('/Count 1'), true);
  assert.equal(pdf.includes('/MediaBox [0 0 595.28 841.89]'), true);
  assert.match(pdf, /\/Title <FEFF/);
});

test('标准操作流程生成多页 A4 PDF 并使用 Unicode 元数据', () => {
  const buffer = generateSopPdf({ exportedAt: '2026-11-08 12:00' });
  const pdf = buffer.toString('latin1');
  assert.equal(pdf.includes('/Count 4'), true);
  assert.equal(pdf.includes('/MediaBox [0 0 595.28 841.89]'), true);
  assert.match(pdf, /\/Title <FEFF/);
  assert.match(pdf, /\/FontFile2/);
});

test('CSV 使用 UTF-8 BOM 和 RFC 4180 引号转义', () => {
  const buffer = generateCsv({
    rows: [{ name: '备注,含逗号', note: '引号"测试' }],
    columns: [{ key: 'name', label: '名称' }, { key: 'note', label: '备注' }],
  });
  const text = buffer.toString('utf8');
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(text, /"备注,含逗号"/);
  assert.match(text, /"引号""测试"/);
});

test('记录清单 CSV 包含复核字段', () => {
  const buffer = generateRecordsCsv([makeRecord()], [device], { U001: '李一', U003: '齐一' });
  const text = buffer.toString('utf8');
  assert.match(text, /记录编号/);
  assert.match(text, /复核确认人/);
  assert.match(text, /齐一/);
});
