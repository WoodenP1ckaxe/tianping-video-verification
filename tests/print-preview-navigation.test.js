import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dirname, '..', 'public', 'assets', 'app.js'),
  'utf8'
);

test('周统计预览读取表单中当前选择的天平和周', () => {
  assert.match(source, /data-action="preview-week"/);
  assert.doesNotMatch(source, /href="#\/print\/week\?week=\$\{attr\(week\.week\)\}"/);
  assert.match(
    source,
    /case 'preview-week':[\s\S]{0,500}formObject\(form\)[\s\S]{0,300}data\.week/
  );
});
