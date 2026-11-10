import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodeQrCodesFromPixels } from '../src/services/display-ocr.js';
import {
  generateDeviceCardSvg,
  generatePersonCardSvg,
  deviceQrContent,
  personQrContent,
} from '../src/services/qr.js';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');

function drawQr(pixels, width, content, left, top, scale = 7) {
  const matrix = qrcode(0, 'H');
  matrix.addData(content, 'Byte');
  matrix.make();
  const quiet = 4;
  for (let row = 0; row < matrix.getModuleCount() + quiet * 2; row += 1) {
    for (let column = 0; column < matrix.getModuleCount() + quiet * 2; column += 1) {
      const dark = row >= quiet
        && column >= quiet
        && row < matrix.getModuleCount() + quiet
        && column < matrix.getModuleCount() + quiet
        && matrix.isDark(row - quiet, column - quiet);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const x = left + column * scale + dx;
          const y = top + row * scale + dy;
          const offset = (y * width + x) * 4;
          const value = dark ? 0 : 255;
          pixels[offset] = value;
          pixels[offset + 1] = value;
          pixels[offset + 2] = value;
          pixels[offset + 3] = 255;
        }
      }
    }
  }
}

test('同一画面中的人员卡和设备卡均可被解码', () => {
  const width = 520;
  const height = 260;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  const person = personQrContent('U001');
  const device = deviceQrContent({ id: 'F001', qrValue: 'F001' });
  drawQr(pixels, width, person, 18, 35, 5);
  drawQr(pixels, width, device, 300, 35, 5);
  const decoded = decodeQrCodesFromPixels(pixels, width, height);
  assert.deepEqual(
    new Set(decoded.map((item) => item.data)),
    new Set([person, device])
  );
});

test('二维码卡片包含可扫描类型前缀、大号编号和用途说明', () => {
  const person = generatePersonCardSvg({
    id: 'U001',
    name: '李一',
    roleLabel: '检验人员',
  });
  const device = generateDeviceCardSvg({
    id: 'F001',
    uniqueNo: 'DZTP170911C',
    dept: '化学室',
    qrValue: 'F001',
  });
  assert.equal(personQrContent('U001'), 'PERSON:U001');
  assert.equal(deviceQrContent({ id: 'F001', qrValue: 'F001' }), 'DEVICE:F001');
  assert.match(person, /<path d="M/);
  assert.match(person, />U001</);
  assert.match(person, /本人专用，不得转借/);
  assert.match(device, />F001</);
  assert.match(device, /DZTP170911C/);
  assert.match(device, /长期固定在设备正面或侧面/);
});
