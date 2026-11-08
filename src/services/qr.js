import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function qrModules(content) {
  const matrix = qrcode(0, 'H');
  matrix.addData(String(content), 'Byte');
  matrix.make();
  const count = matrix.getModuleCount();
  const quietZone = 4;
  const cells = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (matrix.isDark(row, column)) {
        cells.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`);
      }
    }
  }
  return {
    count: count + quietZone * 2,
    path: cells.join(''),
  };
}

/**
 * 生成可直接打印并离线扫描的身份卡 SVG。二维码内容使用带类型前缀的纯文本，
 * 与视频分析器兼容，同时避免人员编号和设备编号同名时产生身份歧义。
 */
export function generateIdentityCardSvg({
  kind,
  content,
  primary,
  secondary = '',
  description = '',
}) {
  const isPerson = kind === 'person';
  const qr = qrModules(content);
  const title = isPerson ? '人员身份识别码' : '天平设备识别码';
  const fallbackDescription = isPerson
    ? '校验前请将本人卡片出示给镜头'
    : '请长期固定在设备正面或侧面';
  const accent = isPerson ? '#0b6b61' : '#174f85';
  const accentSoft = isPerson ? '#e4f4f1' : '#e8f1FA';
  const qrScale = 330 / qr.count;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="660" height="390" viewBox="0 0 660 390" role="img" aria-label="${escapeXml(title)} ${escapeXml(primary)}">
  <rect width="660" height="390" rx="18" fill="#ffffff"/>
  <rect x="1" y="1" width="658" height="388" rx="17" fill="none" stroke="#b8c5ce" stroke-width="2"/>
  <rect x="24" y="24" width="374" height="342" rx="12" fill="#ffffff" stroke="${accent}" stroke-width="2"/>
  <g transform="translate(46 46) scale(${qrScale.toFixed(6)})">
    <rect width="${qr.count}" height="${qr.count}" fill="#ffffff"/>
    <path d="${qr.path}" fill="#000000" shape-rendering="crispEdges"/>
  </g>
  <rect x="416" y="24" width="220" height="42" rx="21" fill="${accentSoft}"/>
  <text x="526" y="51" fill="${accent}" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="17" font-weight="700" text-anchor="middle">${escapeXml(title)}</text>
  <text x="424" y="132" fill="#172b3a" font-family="Consolas,'Microsoft YaHei',sans-serif" font-size="50" font-weight="800" letter-spacing="1">${escapeXml(primary)}</text>
  ${secondary ? `<text x="426" y="177" fill="#506575" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="17">${escapeXml(secondary)}</text>` : ''}
  <line x1="424" y1="204" x2="618" y2="204" stroke="#d5dee4" stroke-width="2"/>
  <text x="424" y="244" fill="#263d4e" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="16" font-weight="700">${isPerson ? '本人专用，不得转借' : '用于天平身份核对'}</text>
  <text x="424" y="274" fill="#657a89" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="14">${escapeXml(description || fallbackDescription)}</text>
  <text x="424" y="325" fill="#7d8f9b" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="12">扫描内容仅含身份编号，不含敏感信息</text>
  <text x="424" y="349" fill="#7d8f9b" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif" font-size="12">CORRECTION: H · PRINT SIZE: ≥ 40 mm</text>
</svg>`;
}

export function personQrContent(accountId) {
  return `PERSON:${String(accountId || '').trim()}`;
}

export function deviceQrContent(device) {
  return `DEVICE:${String(device?.qrValue || device?.id || '').trim()}`;
}

export function generatePersonCardSvg(account) {
  return generateIdentityCardSvg({
    kind: 'person',
    content: personQrContent(account?.id),
    primary: account?.id || '',
    secondary: `${account?.name || ''} · ${account?.roleLabel || ''}`.replace(/\s·\s$/, ''),
    description: '校验前请将本人卡片出示给镜头',
  });
}

export function generateDeviceCardSvg(device) {
  return generateIdentityCardSvg({
    kind: 'device',
    content: deviceQrContent(device),
    primary: device?.id || '',
    secondary: `唯一号 ${device?.uniqueNo || '—'} · ${device?.dept || ''}`.replace(/\s·\s$/, ''),
    description: '请长期固定在设备正面或侧面',
  });
}

export default {
  generateIdentityCardSvg,
  generatePersonCardSvg,
  generateDeviceCardSvg,
  personQrContent,
  deviceQrContent,
};
