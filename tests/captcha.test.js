import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.js';
import {
  LOCKOUT_AFTER_ATTEMPTS,
  LOCKOUT_MINUTES,
  UNKNOWN_LOGIN_LIMIT,
  login
} from '../src/auth.js';

function request() {
  return {
    headers: { 'user-agent': 'lockout-test' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

test('连续五次口令错误后锁定账号十分钟并写审计', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-lockout-'));
  const { db } = openDatabase({
    dataDir: temporary,
    initialPassword: 'Tp123456'
  });
  t.after(() => {
    db.close();
    rmSync(temporary, { recursive: true, force: true });
  });

  for (let attempt = 1; attempt <= LOCKOUT_AFTER_ATTEMPTS; attempt += 1) {
    assert.throws(
      () => login(db, request(), 'U001', 'wrong-password'),
      (error) => {
        if (attempt === LOCKOUT_AFTER_ATTEMPTS) {
          assert.equal(error.code, 'ACCOUNT_LOCKED');
          assert.equal(error.status, 423);
          assert.equal(error.details.failedAttempts, attempt);
          assert.ok(error.details.lockedUntil > Date.now());
        } else {
          assert.equal(error.code, 'LOGIN_FAILED');
          assert.equal(error.status, 401);
          assert.equal(error.details, null);
          assert.equal(error.message, '账号或口令错误');
        }
        return true;
      }
    );
  }

  const locked = db.prepare(`
    SELECT failed_attempts, locked_until FROM users WHERE id = 'U001'
  `).get();
  assert.equal(locked.failed_attempts, LOCKOUT_AFTER_ATTEMPTS);
  assert.ok(
    locked.locked_until - Date.now()
      >= (LOCKOUT_MINUTES - 1) * 60 * 1000
  );
  assert.throws(
    () => login(db, request(), 'U001', 'Tp123456'),
    (error) => error.code === 'ACCOUNT_LOCKED' && error.status === 423
  );

  db.prepare(`
    UPDATE users SET locked_until = ? WHERE id = 'U001'
  `).run(Date.now() - 1000);
  const result = login(db, request(), 'U001', 'Tp123456');
  assert.equal(result.user.id, 'U001');
  const reset = db.prepare(`
    SELECT failed_attempts, locked_until FROM users WHERE id = 'U001'
  `).get();
  assert.equal(reset.failed_attempts, 0);
  assert.equal(reset.locked_until, null);
  assert.ok(db.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs WHERE type = '账号锁定'
  `).get().count >= 1);
});

test('未知账号登录按来源限流且不泄露账号是否存在', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-login-rate-'));
  const { db } = openDatabase({
    dataDir: temporary,
    initialPassword: 'Tp123456'
  });
  t.after(() => {
    db.close();
    rmSync(temporary, { recursive: true, force: true });
  });

  for (let attempt = 1; attempt <= UNKNOWN_LOGIN_LIMIT; attempt += 1) {
    assert.throws(
      () => login(db, request(), `MISSING-${attempt}`, 'wrong-password'),
      (error) => error.code === 'LOGIN_FAILED' && error.status === 401
    );
  }
  assert.throws(
    () => login(db, request(), 'MISSING-FINAL', 'wrong-password'),
    (error) => error.code === 'LOGIN_RATE_LIMITED'
      && error.status === 429
      && error.details.retryAfterSeconds > 0
  );
});
