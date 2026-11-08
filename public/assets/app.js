/* global window, document, fetch, URLSearchParams, Blob, File, indexedDB */

const root = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
let loginCaptcha = null;
let lastLoginAccount = '';

const ROLE_LABEL = {
  admin: '管理员',
  inspector: '检验人员',
  verifier: '复核确认人员'
};

const STATUS_CLASS = {
  排队中: 'blue',
  分析中: 'violet',
  已完成: 'green',
  失败: 'red',
  待人工处理: 'amber',
  已取消: 'gray',
  待提交: 'amber',
  已提交: 'blue',
  已复核确认: 'green',
  已作废: 'gray',
  通过: 'green',
  不通过: 'red',
  启用: 'green',
  停用: 'gray',
  在用: 'green',
  正常: 'green',
  异常: 'red',
  运行中: 'green',
  已停止: 'red'
};

const ICON_PATHS = {
  scale: '<path d="M12 3v18M5 7h14M7 7l-4 8h8L7 7Zm10 0-4 8h8l-4-8Z"/><path d="M8 21h8"/>',
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v5h16v-5"/>',
  tasks: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  records: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h6M9 16h6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  template: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v3h16v-3"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.3-4 2.3-6 5.5-6s5.2 2 5.5 6"/><path d="M15 5.5a3 3 0 0 1 0 5.8M16 14c2.7.4 4.2 2.4 4.5 5"/>',
  audit: '<path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>',
  logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 22 21H2z"/><path d="M12 9v5M12 18h.01"/>',
  camera: '<path d="M4 7h4l1.5-2h5L16 7h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  printer: '<path d="M6 9V3h12v6M6 17H4v-7h16v7h-2"/><rect x="7" y="14" width="10" height="7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>'
  ,qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M17 20h4M14 20h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.8-1.7 1.3-1.7 2.7M12 17.5h.01"/>'
};

const state = {
  session: null,
  data: null,
  csrfToken: '',
  route: '',
  loadingRecordId: null,
  ui: {
    sidebarOpen: false,
    masterTab: 'devices',
    qrDevice: '',
    deviceDirectoryQuery: '',
    recordPage: 1,
    auditPage: 1
  },
  filters: {
    records: {
      devices: [],
      from: '',
      to: '',
      inspector: '',
      status: '',
      conclusion: ''
    },
    verify: {
      device: '',
      from: '',
      to: '',
      inspector: ''
    },
    history: {
      from: '',
      to: '',
      conclusion: ''
    },
    audit: {
      from: '',
      to: '',
      account: '',
      type: ''
    }
  },
  recordsView: {
    loaded: false,
    loading: false,
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    error: ''
  },
  historyView: {
    device: '',
    loaded: false,
    loading: false,
    items: [],
    total: 0,
    page: 1,
    pageSize: 200,
    totalPages: 1,
    error: ''
  },
  weekPrint: {
    key: '',
    loaded: false,
    loading: false,
    items: [],
    error: ''
  },
  verifyView: {
    loaded: false,
    loading: false,
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
    totalPages: 1,
    error: ''
  },
  upload: {
    file: null,
    startedAt: '',
    expectedDeviceId: '',
    confirmed: false,
    uploadId: null,
    offset: 0,
    progress: 0,
    status: '',
    message: '',
    abortController: null,
    busy: false,
    completedTaskId: '',
    sha256: '',
    duplicateWarning: '',
    metadataStartTime: ''
  },
  modal: null
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function attr(value) {
  return esc(value);
}

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

function roleLabel(role) {
  return ROLE_LABEL[role] || role;
}

function tag(value, className = null) {
  const text = String(value ?? '—');
  return `<span class="tag ${className || STATUS_CLASS[text] || 'gray'}">${esc(text)}</span>`;
}

function accountName(id) {
  const account = state.data?.accounts?.find((item) => item.id === id);
  return account?.name || id || '—';
}

function deviceById(id) {
  return state.data?.devices?.find((item) => item.id === id) || null;
}

function recordById(id) {
  return state.data?.records?.find((item) => item.id === id) || null;
}

function recordEvaluation(record) {
  return record?.evaluation || state.data?.evaluations?.[record?.id] || null;
}

function can(permission) {
  return Boolean(state.data?.user?.permissions?.includes(permission));
}

function isRole(role) {
  return state.data?.user?.role === role;
}

function formatNumber(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : String(value);
}

function formatDate(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 16);
}

function formatFileSize(mb) {
  const value = Number(mb);
  if (!Number.isFinite(value)) return '—';
  if (value >= 1) return `${value.toFixed(1)} MB`;
  const kilobytes = value * 1024;
  if (value > 0 && kilobytes < 1) return '<1 KB';
  return `${Math.round(kilobytes)} KB`;
}

function formatDuration(milliseconds) {
  const ms = Number(milliseconds);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

function formatRetention(days) {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return '无法估算';
  const value = Number(days);
  if (value < 60) return `约 ${Math.round(value)} 天`;
  if (value < 365) return `约 ${(value / 30).toFixed(1)} 个月`;
  return `约 ${(value / 365).toFixed(1)} 年`;
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function currentDateTimeInput() {
  const p = shanghaiParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function currentDateTimeText() {
  const p = shanghaiParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function todayText() {
  const p = shanghaiParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function daysAgoText(days) {
  return new Date(Date.now() - days * 86_400_000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function dateTimeAtOffset(base, seconds) {
  const normalized = String(base || currentDateTimeText()).replace(' ', 'T').slice(0, 16) + ':00+08:00';
  const date = new Date(new Date(normalized).getTime() + Number(seconds || 0) * 1000);
  const p = shanghaiParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function naturalWeekRange(anchorText = todayText()) {
  const anchor = new Date(`${anchorText}T00:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - weekday + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
    week: isoWeekValue(anchorText)
  };
}

function isoWeekValue(anchorText = todayText()) {
  const anchor = new Date(`${anchorText}T00:00:00Z`);
  const day = anchor.getUTCDay() || 7;
  const thursday = new Date(anchor);
  thursday.setUTCDate(anchor.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekRangeFromIso(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match) return naturalWeekRange();
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - mondayOffset + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
    week: `${year}-W${String(week).padStart(2, '0')}`
  };
}

function parseRoute() {
  const raw = window.location.hash.slice(1) || '/dashboard';
  const index = raw.indexOf('?');
  const path = index >= 0 ? raw.slice(0, index) : raw;
  const query = new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    query
  };
}

function navigate(path) {
  state.ui.sidebarOpen = false;
  if (window.location.hash.slice(1) === path) {
    render();
  } else {
    window.location.hash = path;
  }
}

function toast(message, type = '', timeout = 3200) {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  toastRoot.appendChild(node);
  window.setTimeout(() => node.remove(), timeout);
}

class ClientError extends Error {
  constructor(message, status = 0, code = '', details = null) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function fetchResponse(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;
  if (options.raw !== undefined) {
    body = options.raw;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined && body !== null && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  if (!['GET', 'HEAD'].includes(method) && state.csrfToken) {
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body,
      signal: options.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ClientError('无法连接本地应用服务，请检查服务器状态', 0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A non-JSON proxy error still needs a stable user-facing message.
    }
    const error = new ClientError(
      payload?.error?.message || `请求失败（HTTP ${response.status}）`,
      response.status,
      payload?.error?.code || '',
      payload?.error?.details || null
    );
    if (response.status === 401 && !options.allowUnauthorized) {
      state.session = null;
      state.data = null;
      state.csrfToken = '';
      window.setTimeout(renderLogin, 0);
    }
    throw error;
  }
  return response;
}

async function api(path, options = {}) {
  const response = await fetchResponse(path, options);
  const type = response.headers.get('content-type') || '';
  if (options.responseType === 'blob') return response;
  if (!type.includes('application/json')) return response.text();
  return response.json();
}

function errorMessage(error) {
  if (!error) return '操作失败';
  if (Array.isArray(error.details) && error.details.length) {
    return `${error.message}：${error.details.join('；')}`;
  }
  if (error.details?.code) return `${error.message}（${error.details.code}）`;
  return error.message || '操作失败';
}

async function loadState({ renderAfter = true } = {}) {
  const data = await api('/api/state', { allowUnauthorized: true });
  state.data = data;
  state.session = data.user;
  state.csrfToken = data.csrfToken || state.csrfToken;
  state.recordsView.loaded = false;
  state.historyView.loaded = false;
  state.weekPrint.loaded = false;
  state.weekPrint.key = '';
  state.verifyView.loaded = false;
  if (renderAfter) render();
  return data;
}

async function boot() {
  try {
    const session = await api('/api/session', { allowUnauthorized: true });
    state.session = session;
    state.csrfToken = session.csrfToken || '';
    if (session.mustChangePassword) {
      renderChangePassword();
      return;
    }
    await loadState({ renderAfter: false });
    await restoreUploadSession();
    render();
  } catch (error) {
    if (error.status === 401) renderLogin();
    else {
      root.innerHTML = `<div class="change-screen"><div class="change-card">
        <h1>系统暂时无法访问</h1>
        <div class="alert danger mt12">${esc(errorMessage(error))}</div>
        <button class="btn btn-primary mt16" data-action="retry-boot">重新连接</button>
      </div></div>`;
    }
  }
}

function renderLogin(message = '') {
  state.data = null;
  state.session = null;
  state.csrfToken = '';
  root.innerHTML = `
    <main class="login-page">
      <section class="login-visual">
        <div class="login-brand">
          <span class="brand-mark">${icon('scale', 23)}</span>
          <span>天平校验视频分析系统</span>
        </div>
        <h1>以视频为证，让每一次<br><em>外部校验</em>都可追溯。</h1>
        <p>固定支架视频自动进入串行分析队列，提取人员卡、设备卡与九次称量示值；
          判定、电子确认、复核签名与 PDF 留档形成完整证据链。</p>
      </section>
      <section class="login-panel">
        <h2>账号登录</h2>
        ${message ? `<div class="alert danger">${esc(message)}</div>` : ''}
        <form class="mt16" data-form="login">
          <div class="field">
            <label for="login-account" class="required">账号</label>
            <input id="login-account" name="account" autocomplete="username" required maxlength="20" placeholder="请输入账号" value="${attr(lastLoginAccount)}">
          </div>
          <div class="field mt12">
            <label for="login-password" class="required">口令</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="请输入口令">
          </div>
          <div class="captcha-block mt12 ${loginCaptcha ? '' : 'hidden'}" id="login-captcha-block">
            <label for="login-captcha" class="required">登录验证码</label>
            <div class="captcha-row">
              <div class="captcha-image">${loginCaptcha?.svg || ''}</div>
              <button type="button" class="btn btn-secondary btn-sm" data-action="refresh-login-captcha">换一张</button>
            </div>
            <input id="login-captcha" name="captchaAnswer" autocomplete="off" maxlength="6" ${loginCaptcha ? 'required' : ''} placeholder="输入图中 6 位字符（不区分大小写）">
            <input type="hidden" name="captchaToken" value="${attr(loginCaptcha?.token || '')}">
            <p class="muted small mt8">连续错误 5 次后启用。验证码有效 5 分钟，不限制重试次数。</p>
          </div>
          <button class="btn btn-primary btn-lg btn-block mt16" type="submit" data-submit-label>安全登录</button>
        </form>
      </section>
    </main>`;
}

function renderChangePassword() {
  const user = state.session?.user || state.session;
  if (!user) {
    renderLogin();
    return;
  }
  root.innerHTML = `
    <main class="change-screen">
      <section class="change-card">
        <span class="brand-mark">${icon('scale', 23)}</span>
        <h1 style="margin:0;font-size:21px">首次登录：修改口令</h1>
        <p class="muted small">账号 ${esc(user.id)} · ${esc(user.name)}。新口令至少 8 位，并同时包含字母和数字。</p>
        <div id="change-error"></div>
        <form class="mt16" data-form="change-password">
          <div class="field">
            <label class="required">当前口令</label>
            <input name="currentPassword" type="password" autocomplete="current-password" required>
          </div>
          <div class="field mt12">
            <label class="required">新口令</label>
            <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <div class="field mt12">
            <label class="required">确认新口令</label>
            <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <button type="submit" class="btn btn-primary btn-block btn-lg mt16" data-submit-label>修改口令并进入系统</button>
        </form>
        <button class="btn btn-ghost btn-block mt12" data-action="logout">退出登录</button>
      </section>
    </main>`;
}

function navigationItems() {
  const queueCount = state.data?.queue?.queued || 0;
  const pendingVerify = Number(state.data?.recordSummary?.byStatus?.['已提交'] || 0);
  const myDrafts = state.data?.records?.filter(
    (record) => record.status === '待提交' && record.inspector === state.data?.user?.id
  ).length || 0;
  const groups = [
    {
      label: '业务工作',
      items: [
        { path: '/dashboard', label: '工作台', icon: 'dashboard' },
        { path: '/records', label: '校验记录', icon: 'records' },
        { path: '/help', label: '操作流程', icon: 'help' },
        { path: '/export', label: '导出与打印', icon: 'download' }
      ]
    }
  ];
  if (isRole('inspector')) {
    groups[0].items.splice(1, 0,
      { path: '/upload', label: '上传校验视频', icon: 'upload' },
      { path: '/tasks', label: '我的分析任务', icon: 'tasks', badge: queueCount || null },
      { path: '/records', href: '/records?draft=1', label: '记录核对', icon: 'check', badge: myDrafts || null },
      { path: '/devices', label: '天平档案', icon: 'database' },
      { path: '/qr', label: '二维码', icon: 'qr' }
    );
    groups[0].items = groups[0].items.filter((item, index, list) => (
      item.label !== '校验记录' || index === list.findIndex((candidate) => candidate.label === '记录核对')
    ));
  } else if (isRole('verifier')) {
    groups[0].items.splice(1, 0,
      { path: '/verify', label: '待复核', icon: 'check', badge: pendingVerify || null },
      { path: '/masterdata', label: '天平与砝码盒', icon: 'database' },
      { path: '/template', label: '记录模板', icon: 'template' },
      { path: '/qr', label: '设备二维码', icon: 'qr' }
    );
  } else if (isRole('admin')) {
    groups[0].items.splice(1, 0, { path: '/tasks', label: '分析队列', icon: 'tasks', badge: queueCount || null });
    groups.push({
      label: '系统管理',
      items: [
        { path: '/masterdata', label: '主数据', icon: 'database' },
        { path: '/template', label: '记录模板', icon: 'template' },
        { path: '/accounts', label: '账号与角色', icon: 'users' },
        { path: '/audit', label: '审计日志', icon: 'audit' },
        { path: '/system', label: '运行状态', icon: 'server' }
      ]
    });
  }
  return groups;
}

function isActiveRoute(itemPath, routePath) {
  if (itemPath === '/dashboard') return routePath === '/dashboard';
  if (itemPath === '/records') return routePath === '/records' || routePath.startsWith('/records/') || routePath.startsWith('/history/');
  if (itemPath === '/tasks') return routePath === '/tasks';
  return routePath === itemPath;
}

function shell(title, subtitle, content, options = {}) {
  const user = state.data.user;
  const nav = navigationItems().map((group) => `
    <div class="nav-group">
      <div class="nav-label">${esc(group.label)}</div>
      ${group.items.map((item) => `
        <a href="#${attr(item.href || item.path)}" class="nav-link ${isActiveRoute(item.path, options.pathname || parseRoute().path) ? 'active' : ''}">
          ${icon(item.icon)}
          <span>${esc(item.label)}</span>
          ${item.badge ? `<span class="nav-badge">${Number(item.badge)}</span>` : ''}
        </a>`).join('')}
    </div>`).join('');
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar ${state.ui.sidebarOpen ? 'open' : ''}" id="sidebar">
        <a class="brand" href="#/dashboard">
          <span class="brand-mark">${icon('scale', 21)}</span>
          <span class="brand-copy"><strong>天平校验</strong><span>Video verification</span></span>
        </a>
        <nav>${nav}</nav>
        <div class="sidebar-footer"><span class="dot"></span>内网离线服务 · Asia/Shanghai</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="打开导航">${icon('menu')}</button>
          <div class="page-crumb"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>
          <div class="topbar-spacer"></div>
          <span class="clock">${esc(currentDateTimeText())}</span>
          <div class="user-chip">
            <span class="avatar">${esc(user.name.slice(0, 1))}</span>
            <span class="user-text"><strong>${esc(user.name)}</strong><span>${esc(roleLabel(user.role))} · ${esc(user.id)}</span></span>
            <button class="icon-btn" data-action="logout" title="退出登录" aria-label="退出登录">${icon('logout')}</button>
          </div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>`;
  wireDynamic();
}

function pageHeader(title, subtitle, actions = '') {
  return `
    <div class="page-head">
      <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
      ${actions ? `<div class="head-actions">${actions}</div>` : ''}
    </div>`;
}

function roleActions() {
  if (isRole('inspector')) {
    return `<a class="btn btn-primary" href="#/upload">${icon('upload')}上传校验视频</a>
      <a class="btn btn-secondary" href="#/records?draft=1">${icon('check')}核对待提交</a>`;
  }
  if (isRole('verifier')) {
    return `<a class="btn btn-primary" href="#/verify">${icon('check')}进入待复核</a>
      <a class="btn btn-secondary" href="#/export">${icon('printer')}导出留档</a>`;
  }
  return `<a class="btn btn-primary" href="#/tasks">${icon('tasks')}查看分析队列</a>
    <a class="btn btn-secondary" href="#/system">${icon('server')}运行状态</a>`;
}

function pageDashboard() {
  const records = state.data.records || [];
  const summary = state.data.recordSummary || {};
  const pendingDraftCount = isRole('inspector')
    ? Number(summary.ownPendingDrafts || 0)
    : Number(summary.byStatus?.['待提交'] || 0);
  const pendingVerifyCount = Number(summary.byStatus?.['已提交'] || 0);
  const todayCount = isRole('inspector')
    ? Number(summary.ownToday || 0)
    : Number(summary.today || 0);
  const failedTasks = (state.data.tasks || []).filter((task) => task.status === '失败' || task.status === '待人工处理');
  const stats = isRole('inspector')
    ? [
      ['今日已上传', todayCount, '条校验记录', 'blue'],
      ['待核对提交', pendingDraftCount, '条记录等待电子确认', 'amber'],
      ['分析队列', state.data.queue?.queued || 0, '段视频排队中', 'violet'],
      ['最近异常', failedTasks.filter((task) => task.user === state.data.user.id).length, '项任务需关注', 'red']
    ]
    : isRole('verifier')
      ? [
        ['待复核记录', pendingVerifyCount, '条记录等待电子签名', 'amber'],
        ['今日完成校验', todayCount, '条日常校验记录', 'blue'],
        ['累计已复核', Number(summary.byStatus?.['已复核确认'] || 0), '条可正式导出', 'green'],
        ['异常记录', records.filter((record) => recordEvaluation(record)?.conclusion === '不通过').length, '条含判定不满足项', 'red']
      ]
      : [
        ['分析队列', state.data.queue?.queued || 0, '段等待分析', 'blue'],
        ['待复核', pendingVerifyCount, '条记录等待复核', 'amber'],
        ['今日记录', todayCount, '条已生成校验记录', 'green'],
        ['异常任务', failedTasks.length, '项失败或待人工处理', 'red']
      ];
  const recent = records
    .filter((record) => isRole('inspector') || record.status !== '待提交' || record.inspector === state.data.user.id)
    .slice(0, 7);
  const tasks = (state.data.tasks || [])
    .filter((task) => ['分析中', '排队中'].includes(task.status))
    .sort((left, right) => (
      Number(left.queuePosition || Number.MAX_SAFE_INTEGER)
      - Number(right.queuePosition || 0)
    ))
    .slice(0, 5);
  return `${pageHeader('工作台', `欢迎回来，${state.data.user.name}。今天也要完成可追溯的设备校验。`)}
    <section class="hero">
      <div class="hero-kicker">Daily verification · 可操作 / 可重复 / 可溯源</div>
      <h1>把一次视频校验，转化为可复核、可留档的电子记录。</h1>
      <p>系统按固定规则复算九次称量示值；判定不通过同样是正式记录，不会因异常而丢失追溯链。</p>
      <div class="hero-actions">${roleActions()}</div>
    </section>
    <div class="grid grid-4 mt16">
      ${stats.map(([label, value, note, tone], index) => `
        <article class="card stat-card ${tone === 'green' || tone === 'blue' ? 'teal' : tone === 'amber' ? 'amber' : 'violet'}">
          <div class="stat-label">${esc(label)}</div>
          <div class="stat-value">${Number(value)}</div>
          <div class="stat-note">${esc(note)}</div>
        </article>`).join('')}
    </div>
    <div class="grid grid-3 mt16">
      <section class="card span-2">
        <div class="card-head"><div><h2>最近校验记录</h2><p>按生成时间显示；点击记录查看示值、截图和追溯信息</p></div>
          <a class="btn btn-ghost btn-sm" href="#/records">全部记录</a></div>
        ${recordsTable(recent, { compact: true })}
      </section>
      <section class="card">
        <div class="card-head"><div><h2>分析队列</h2><p>单机串行 · 严格按上传顺序</p></div>${tag(state.data.queue?.running ? '分析中' : '空闲', state.data.queue?.running ? 'violet' : 'gray')}</div>
        <div class="queue-list">
          ${tasks.length ? tasks.map((task) => `
            <div class="queue-item">
              <span class="queue-pos">${task.status === '分析中' ? '▶' : esc(task.queuePosition || '—')}</span>
              <span><strong>${esc(task.file)}</strong><small>${esc(task.user)} · ${esc(formatDate(task.queuedAt))}</small></span>
              ${tag(task.status)}
            </div>`).join('') : `<div class="empty"><strong>队列空闲</strong>暂无分析任务</div>`}
        </div>
        <div class="card-foot row between">
          <span class="muted small">当前队列 ${Number(state.data.queue?.queued || 0)} 段</span>
          <a class="btn btn-secondary btn-sm" href="#/tasks">查看任务</a>
        </div>
      </section>
    </div>`;
}

function recordsTable(records, options = {}) {
  if (!records.length) return `<div class="empty"><strong>暂无记录</strong>符合当前范围的校验记录会显示在这里。</div>`;
  const limit = options.compact ? records.length : 50;
  return `
    <div class="table-wrap desktop-table">
      <table>
        <thead><tr>
          <th>校验日期</th><th>天平编号 / 唯一号</th><th>检验人员</th><th>砝码盒</th>
          <th>判定</th><th>复核状态</th><th>提交时间</th><th>复核时间</th><th></th>
        </tr></thead>
        <tbody>${records.slice(0, limit).map((record) => `
          <tr class="${record.status === '已作废' ? 'row-muted' : ''}">
            <td class="nowrap num">${esc(record.date)}</td>
            <td><a href="#/records/${encodeURIComponent(record.id)}"><b>${esc(record.device)}</b></a>
              <div class="muted small">${esc(record.deviceSnapshot?.uniqueNo || deviceById(record.device)?.uniqueNo || '—')} · ${esc(record.id)}</div></td>
            <td>${esc(accountName(record.inspector))}</td>
            <td class="num">${esc(record.box || '—')}</td>
            <td>${tag(recordEvaluation(record)?.conclusion || '—')}</td>
            <td>${tag(record.status)}</td>
            <td class="num nowrap">${esc(formatDate(record.submittedAt))}</td>
            <td class="num nowrap">${esc(formatDate(record.verifiedAt))}</td>
            <td class="col-actions"><a class="btn btn-ghost btn-sm" href="#/records/${encodeURIComponent(record.id)}">查看</a></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="card-list">
      ${records.slice(0, limit).map((record) => `
        <a class="info-card" href="#/records/${encodeURIComponent(record.id)}">
          <div class="row between"><strong>${esc(record.device)}</strong>${tag(record.status)}</div>
          <h3 class="mt8">${esc(record.id)}</h3>
          <p>${esc(record.date)} · ${esc(record.deviceSnapshot?.uniqueNo || deviceById(record.device)?.uniqueNo || '—')} · ${esc(accountName(record.inspector))}</p>
          <div class="row between mt8"><span class="muted small">砝码盒 ${esc(record.box || '—')}</span>${tag(recordEvaluation(record)?.conclusion || '—')}</div>
        </a>`).join('')}
    </div>`;
}

function pageUpload() {
  const up = state.upload;
  const rules = state.data.fileRules;
  if (!up.startedAt) up.startedAt = currentDateTimeInput();
  if (!up.expectedDeviceId) {
    up.expectedDeviceId = state.data.devices.find((device) => device.status === '在用')?.id || '';
  }
  const file = up.file;
  return `${pageHeader('上传校验视频', '上传原始视频并确认拍摄开始时间；服务端按分片接收并计算 SHA-256。')}
    <div class="grid grid-3">
      <section class="card span-2">
        <div class="card-head"><div><h2>选择视频</h2><p>支持手机或 PC 拍摄的 MP4 / MOV 文件</p></div>${file && !up.busy ? `<button class="btn btn-secondary btn-sm" data-action="upload-clear">重新选择</button>` : ''}</div>
        <input id="video-file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" class="sr-only" ${up.busy ? 'disabled' : ''}>
        ${file ? `
          <div class="file-chip">
            <span class="file-icon">${icon('camera')}</span>
            <span class="grow"><strong>${esc(file.name)}</strong><span>${formatFileSize(file.size / 1024 / 1024)} · ${esc((file.name.split('.').pop() || '').toUpperCase())}</span></span>
            ${up.busy ? `<span class="spinner" style="border-color:rgba(23,107,135,.25);border-top-color:var(--blue)"></span>` : ''}
          </div>` : `
          <div class="dropzone" id="upload-dropzone" tabindex="0" role="button" aria-label="选择校验视频">
            <span class="drop-icon">${icon('upload', 24)}</span>
            <strong>点击选择，或将视频拖放到这里</strong>
            <span>单文件 ≤ ${rules.maxSizeMB} MB · 建议时长 ≤ ${rules.maxMinutes} 分钟 · H.264 / AAC</span>
          </div>`}
        <div class="form-grid mt16">
          <div class="field">
            <label for="upload-start" class="required">拍摄开始时间</label>
            <input id="upload-start" name="startedAt" type="datetime-local" value="${attr(up.startedAt)}" ${up.busy ? 'disabled' : ''}>
            <span class="hint">视频有 creation_time 时优先使用元数据；缺失时才要求确认此时间</span>
          </div>
          <div class="field">
            <label>归属检验人员</label>
            <input value="${attr(state.data.user.name)}（${attr(state.data.user.id)}）" disabled>
          </div>
          <div class="field">
            <label for="upload-device" class="required">预计天平</label>
            <select id="upload-device" name="expectedDeviceId" ${up.busy || up.uploadId ? 'disabled' : ''} required>
              ${state.data.devices.filter((device) => device.status === '在用').map((device) => `<option value="${attr(device.id)}" ${up.expectedDeviceId === device.id ? 'selected' : ''}>${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
            </select>
            <span class="hint">仅用于同日重复上传提前提示；正式记录以设备卡为准</span>
          </div>
        </div>
        <label class="row mt12" style="font-size:11px">
          <input type="checkbox" name="timeConfirmed" ${up.confirmed ? 'checked' : ''} ${up.busy ? 'disabled' : ''}>
          <span>若视频缺少拍摄时间元数据，我确认使用上述时间作为校验日期及读数时间基准。</span>
        </label>
        ${up.status ? `<div class="mt16">
          <div class="progress-label"><span>${esc(up.status)}</span><span class="num">${Math.round(up.progress)}%</span></div>
          <div class="progress"><i style="width:${Math.max(0, Math.min(100, up.progress))}%"></i></div>
          ${up.message ? `<div class="alert ${up.completedTaskId ? 'success' : 'warn'} mt12">${esc(up.message)}</div>` : ''}
        </div>` : ''}
        ${up.duplicateWarning ? `<div class="alert warn mt12">${esc(up.duplicateWarning)}</div>` : ''}
        <div class="row row-wrap mt16">
          <button class="btn btn-primary" data-action="upload-start" ${!file || up.busy ? 'disabled' : ''}>
            ${up.busy ? '<span class="spinner"></span>' : icon('upload')} ${up.busy ? '正在上传…' : '开始上传'}
          </button>
          ${up.busy ? '<button class="btn btn-secondary" data-action="upload-cancel">取消上传</button>' : ''}
          ${up.completedTaskId ? `<a class="btn btn-secondary" href="#/tasks">${icon('tasks')}查看分析任务</a>` : ''}
        </div>
      </section>
      <aside class="stack">
        <section class="card">
          <div class="card-head"><h2>拍摄与上传要求</h2>${tag('内网离线', 'green')}</div>
          <div class="account-note" style="display:grid;gap:9px">
            <div><b>01 · 固定机位</b><br>整个校验过程保持手机位置不变，画面同时覆盖显示屏和称重仓。</div>
            <div><b>02 · 清晰卡面</b><br>开头依次展示人员卡、设备卡，每张停留不少于 2 秒。</div>
            <div><b>03 · 稳定读数</b><br>读数稳定后停留不少于 3 秒再取下砝码。</div>
            <div><b>04 · 稳定读数</b><br>每次示值稳定停留至少 3 秒，依次完成九次称量。</div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>当前识别能力</h2></div>
          <div class="alert">${esc(state.data.system?.env?.analyzerMode || 'local-display-ocr')} 模式</div>
          <p class="account-note mt8">系统先在多帧中搜索显示屏候选区域，再逐秒读取该区域，基于七段码模板与离线 OCR 还原示值，并对连续帧做稳定段判定。部署时仍可用 DISPLAY_REGION 强制指定区域；无法形成可信读数时进入“待人工处理”。</p>
        </section>
      </aside>
    </div>`;
}

function pageTasks() {
  const tasks = state.data.tasks || [];
  const queue = state.data.queue || {};
  return `${pageHeader(
    isRole('admin') ? '分析队列' : '我的分析任务',
    '同一时刻只处理一段视频；后上传任务不会插队，失败重试不会产生重复记录。',
    `<button class="btn btn-secondary" data-action="refresh-data">${icon('refresh')}刷新状态</button>`
  )}
    <div class="grid grid-4">
      ${[
        ['排队中', queue.queued || tasks.filter((task) => task.status === '排队中').length, '按上传顺序等待'],
        ['分析中', tasks.filter((task) => task.status === '分析中').length, queue.currentTask ? `当前 ${queue.currentTask.id}` : '单消费者，最多 1 段'],
        ['已完成', tasks.filter((task) => task.status === '已完成').length, '已生成待提交记录'],
        ['需处理', tasks.filter((task) => ['失败', '待人工处理'].includes(task.status)).length, '失败或需人工补录']
      ].map(([label, value, note], index) => `
        <article class="card stat-card ${index === 1 ? 'violet' : index === 3 ? 'amber' : 'teal'}">
          <div class="stat-label">${esc(label)}</div><div class="stat-value">${Number(value)}</div><div class="stat-note">${esc(note)}</div>
        </article>`).join('')}
    </div>
    <div class="alert info mt12">
      当前任务：${esc(queue.currentTask ? `${queue.currentTask.id} · ${queue.currentTask.file}` : '无')} ·
      平均单段分析耗时：${esc(formatDuration(queue.averageSegmentDurationMs ?? queue.averageDurationMs))}
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>任务明细</h2><p>队列状态自动刷新；管理员可取消排队任务、重试失败任务或人工补录</p></div>
        <span class="muted small">最近刷新 ${esc(currentDateTimeText())}</span></div>
      ${tasks.length ? `
        <div class="table-wrap desktop-table"><table>
          <thead><tr><th>队列</th><th>任务编号</th><th>原始文件</th><th>上传 / 分析 / 完成时间</th><th>状态</th><th>记录 / 异常</th><th>耗时</th><th class="col-actions">操作</th></tr></thead>
          <tbody>${tasks.map((task) => `
            <tr class="${['失败','待人工处理'].includes(task.status) ? 'row-danger' : task.status === '已取消' ? 'row-muted' : ''}">
              <td class="num nowrap">${task.status === '分析中' ? '执行中' : task.queuePosition ? `第 ${task.queuePosition} 位` : '—'}</td>
              <td><b class="mono">${esc(task.id)}</b><div class="muted small">${esc(task.user)}</div></td>
              <td>${esc(task.file)}<div class="muted small">${formatFileSize(task.size)}</div></td>
              <td class="small">排队 ${esc(formatDate(task.queuedAt))}<br>开始 ${esc(formatDate(task.startedAt))}<br>完成 ${esc(formatDate(task.finishedAt))}</td>
              <td>${tag(task.status)}</td>
              <td>${task.recordId
                ? `<a href="#/records/${encodeURIComponent(task.recordId)}" class="mono">${esc(task.recordId)}</a>`
                : task.reason ? `<span class="small danger-text">${esc(task.reason)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num">${esc(formatDuration(task.durationMs))}</td>
              <td class="col-actions">${taskActions(task)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="card-list">${tasks.map((task) => `
          <div class="info-card">
            <div class="row between"><strong class="mono">${esc(task.id)}</strong>${tag(task.status)}</div>
            <p>${esc(task.file)} · ${formatFileSize(task.size)}</p>
            <p>${task.queuePosition ? `队列第 ${task.queuePosition} 位 · ` : ''}${esc(formatDate(task.queuedAt))} · ${esc(task.user)}</p>
            <p class="muted small">分析 ${esc(formatDate(task.startedAt))} · 完成 ${esc(formatDate(task.finishedAt))}</p>
            ${task.reason ? `<div class="alert ${task.status === '失败' ? 'danger' : 'warn'} mt8">${esc(task.reason)}</div>` : ''}
            <div class="btn-group mt8">${taskActions(task)}</div>
          </div>`).join('')}</div>` : `<div class="empty"><strong>暂无分析任务</strong>${isRole('inspector') ? '上传一段校验视频后，任务会进入串行队列。' : '目前没有系统内的分析任务。'}</div>`}
    </section>`;
}

function taskActions(task) {
  const actions = [];
  if (task.recordId) {
    actions.push(`<a class="btn btn-ghost btn-sm" href="#/records/${encodeURIComponent(task.recordId)}">查看记录</a>`);
  }
  if (can('tasks.manage') && task.status === '排队中') {
    actions.push(`<button class="btn btn-secondary btn-sm" data-action="task-cancel" data-id="${attr(task.id)}">取消</button>`);
  }
  if (can('tasks.manage') && ['失败', '待人工处理'].includes(task.status)) {
    actions.push(`<button class="btn btn-secondary btn-sm" data-action="task-retry" data-id="${attr(task.id)}">重试</button>`);
    actions.push(`<button class="btn btn-primary btn-sm" data-action="task-manual" data-id="${attr(task.id)}">人工补录</button>`);
  }
  return actions.join('') || '<span class="muted small">只读</span>';
}

async function loadRecordsPage(pageNumber = 1) {
  if (state.recordsView.loading) return;
  const filter = state.filters.records;
  const draftOnly = parseRoute().query.get('draft') === '1';
  const page = Math.max(1, Number(pageNumber) || 1);
  state.recordsView.loading = true;
  state.recordsView.error = '';
  if (parseRoute().path === '/records') render();
  const query = new URLSearchParams();
  for (const device of filter.devices || []) query.append('devices', device);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  if (draftOnly) {
    query.set('inspector', state.data.user.id);
    query.set('status', '待提交');
  } else {
    if (filter.inspector) query.set('inspector', filter.inspector);
    if (filter.status) query.set('status', filter.status);
  }
  if (filter.conclusion) query.set('conclusion', filter.conclusion);
  query.set('page', String(page));
  query.set('pageSize', '50');
  try {
    const result = await api(`/api/records?${query.toString()}`);
    state.recordsView = {
      loaded: true,
      loading: false,
      items: result.items || [],
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || 50),
      totalPages: Number(result.totalPages || 1),
      error: ''
    };
  } catch (error) {
    state.recordsView = {
      ...state.recordsView,
      loaded: true,
      loading: false,
      error: errorMessage(error)
    };
  }
  if (parseRoute().path === '/records') render();
}

function pageRecords() {
  const draftOnly = parseRoute().query.get('draft') === '1';
  const view = state.recordsView;
  const records = view.items || [];
  if (!view.loaded || view.loading) {
    return `${pageHeader(
      draftOnly ? '待核对记录' : '校验记录',
      '正在从服务端读取分页结果…',
      ''
    )}
      <section class="card"><div class="empty"><span class="spinner"></span>正在查询记录</div></section>`;
  }
  const inspectors = state.data.accounts.filter((account) => account.role === 'inspector' && account.status !== '已删除');
  return `${pageHeader(
    draftOnly ? '待核对记录' : '校验记录',
    draftOnly ? '核对低置信读数、视觉复核确认项和砝码盒编号后，一键提交。' : '所有角色均可查询全部记录，不作“仅本人记录”限制。',
    `<button class="btn btn-secondary" data-action="export-records-csv">${icon('download')}导出当前筛选清单</button>`
  )}
    <form class="card filterbar" data-form="record-filter">
      <div class="field"><label>天平编号（可多选）</label><select name="devices" multiple size="4">
        ${state.data.devices.map((device) => `<option value="${attr(device.id)}" ${state.filters.records.devices.includes(device.id) ? 'selected' : ''}>${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
      </select><span class="hint">按住 Ctrl / Command 多选；不选表示全部天平</span></div>
      <div class="field"><label>开始日期</label><input type="date" name="from" value="${attr(state.filters.records.from)}"></div>
      <div class="field"><label>结束日期</label><input type="date" name="to" value="${attr(state.filters.records.to)}"></div>
      <div class="field"><label>检验人员</label><select name="inspector">
        <option value="">全部人员</option>
        ${inspectors.map((account) => `<option value="${attr(account.id)}" ${state.filters.records.inspector === account.id ? 'selected' : ''}>${esc(account.name)}（${esc(account.id)}）</option>`).join('')}
      </select></div>
      <div class="field"><label>记录状态</label><select name="status">
        ${['', '待提交', '已提交', '已复核确认', '已作废'].map((value) => `<option value="${value}" ${state.filters.records.status === value ? 'selected' : ''}>${value || '全部状态'}</option>`).join('')}
      </select></div>
      <div class="field"><label>判定结论</label><select name="conclusion">
        ${['', '通过', '不通过'].map((value) => `<option value="${value}" ${state.filters.records.conclusion === value ? 'selected' : ''}>${value || '全部结论'}</option>`).join('')}
      </select></div>
      <button class="btn btn-primary" type="submit">${icon('records')}查询</button>
      <button class="btn btn-secondary" type="button" data-action="reset-record-filter">重置</button>
    </form>
    <section class="card">
      <div class="card-head"><div><h2>${view.total} 条记录</h2><p>${draftOnly ? '显示本人待提交记录' : '服务端分页，日期倒序排列，点击编号查看完整证据链'}</p></div>
        <a class="btn btn-ghost btn-sm" href="#/records">清除待提交筛选</a></div>
      ${view.error ? `<div class="alert danger">${esc(view.error)}</div>` : ''}
      ${recordsTable(records)}
      <div class="row between mt12">
        <button class="btn btn-secondary btn-sm" data-action="records-page" data-page="${view.page - 1}" ${view.page <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="muted small">第 ${view.page} / ${view.totalPages} 页 · 每页 ${view.pageSize} 条</span>
        <button class="btn btn-secondary btn-sm" data-action="records-page" data-page="${view.page + 1}" ${view.page >= view.totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    </section>`;
}

function evaluationBanner(record) {
  const evaluation = recordEvaluation(record);
  const pass = evaluation?.pass === true;
  const reasons = evaluation?.reasons || [];
  return `<section class="evaluation-banner ${pass ? '' : 'fail'}">
    <div class="evaluation-symbol">${pass ? icon('check', 24) : icon('alert', 24)}</div>
    <div class="grow">
      <h2>外部校正${pass ? '通过' : '不通过'}</h2>
      <p>依据 |I − L| ≤ ${esc(evaluation?.tol ?? 0.05)}% × L，边界值含端点；${pass ? '九次读数全部满足且流程完整。' : `共 ${reasons.length} 项不满足要求。`}</p>
      ${reasons.length ? `<ul class="reason-list">${reasons.map((reason) => `<li><b>${esc(reason.label)}</b>${esc(reason.detail)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>`;
}

function confidenceMark(conf, threshold) {
  if (!Number.isFinite(Number(conf))) return '<span class="conf low">无置信度</span>';
  const low = Number(conf) < threshold;
  return `<span class="conf ${low ? 'low' : ''}">${Math.round(Number(conf) * 100)}%${low ? ' · 需核对' : ''}</span>`;
}

function readoutKey(readout, index) {
  return `I${Number(readout.point) + 1}-${Number(readout.idx ?? ((index % 3) + 1))}`;
}

function formatVideoOffset(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function bboxStyle(bbox) {
  const region = bbox || {
    x: 0.1195,
    y: 0.6510,
    width: 0.7537,
    height: 0.1198
  };
  return [
    `left:${Number(region.x) * 100}%`,
    `top:${Number(region.y) * 100}%`,
    `width:${Number(region.width) * 100}%`,
    `height:${Number(region.height) * 100}%`
  ].join(';');
}

function frameImageUrl(record, readout) {
  if (!readout.screenshot) return '';
  return `/api/records/${encodeURIComponent(record.id)}/screenshots/` +
    encodeURIComponent(readout.screenshot.split('/').pop());
}

function showFrameEvidenceModal(record, key) {
  const readout = (record.readouts || []).find((candidate, index) => (
    readoutKey(candidate, index) === key
  ));
  if (!readout) {
    toast('未找到该读数的识别帧', 'error');
    return;
  }
  const evaluation = recordEvaluation(record);
  const item = evaluation?.items?.find((candidate) => candidate.key === key);
  const offset = Number(readout.frame?.offsetSeconds ?? readout.off ?? 0);
  const displayText = readout.frame?.displayText || readout.recognizedText ||
    `${formatNumber(item?.value ?? readout.value, item?.dec ?? 4)} ${readout.unit || 'g'}`;
  const imageUrl = frameImageUrl(record, readout);
  const bbox = readout.frame?.bbox || readout.bbox;
  openModal({
    title: `识别帧核验 · ${key}`,
    subtitle: `${record.device} · 视频绝对时间 ${formatVideoOffset(offset)} · 黄色框标记显示屏`,
    wide: true,
    body: imageUrl
      ? `<div class="frame-proof">
          <img src="${attr(imageUrl)}" alt="${attr(key)} 真实识别帧与显示屏框选">
          <span class="recognized-region" style="${attr(bboxStyle(bbox))}"></span>
          <span class="frame-badge">${esc(key)} · ${formatVideoOffset(offset)}</span>
        </div>
        <div class="alert info mt12">黄框是系统用于读取数值的显示屏区域。请直接核对框内数字；右侧字段是据此帧写入记录的识别文本和换算值。</div>`
      : '<div class="alert danger">该历史记录没有保存识别帧，不能用于读数追溯。请重新上传视频分析。</div>',
    primary: '关闭',
    cancel: '',
  });
  const footer = modalRoot.querySelector('.modal-foot');
  if (footer && imageUrl) {
    footer.insertAdjacentHTML('afterbegin',
      `<button type="button" class="btn btn-secondary" data-action="frame-play" data-id="${attr(record.id)}" data-off="${offset}">播放此帧</button>`);
  }
  modalRoot.insertAdjacentHTML('beforeend', '');
  const body = modalRoot.querySelector('.modal-body');
  body?.insertAdjacentHTML('beforeend', `
    <div class="frame-evidence-meta">
      <div><span>帧内识别文本</span><strong class="mono">${esc(displayText)}</strong></div>
      <div><span>写入记录数值</span><strong class="mono">${esc(formatNumber(item?.value ?? readout.value, item?.dec ?? 4))} ${esc(readout.unit || 'g')}</strong></div>
      <div><span>视频帧偏移</span><strong class="mono">${formatVideoOffset(offset)}（${offset} 秒）</strong></div>
      <div><span>测量时间</span><strong>${esc(readout.time || '—')}</strong></div>
      <div><span>置信度</span><strong>${readout.conf == null ? '—' : `${Math.round(Number(readout.conf) * 100)}%`}</strong></div>
      <div><span>稳定读数</span><strong>${readout.stable === false ? '否，未满足稳定段' : '是'}</strong></div>
      <div><span>识别引擎</span><strong>${esc(readout.ocr?.method === 'tesseract' ? 'Tesseract 离线 OCR' : readout.ocr?.method === 'seven-segment-template' ? '七段码模板 OCR' : '历史校准数据')}</strong></div>
      <div><span>稳定段</span><strong>${readout.ocr ? `${readout.ocr.segmentStart ?? '—'}s ~ ${readout.ocr.segmentEnd ?? '—'}s` : '—'}</strong></div>
    </div>`);
}

function fieldSelect(record, field, options, label) {
  const editable = record.status === '待提交';
  return `<select class="record-field" data-record="${attr(record.id)}" data-field="${attr(field)}"
    ${editable ? '' : 'disabled'} aria-label="${attr(label)}">
    <option value="">待确认</option>
    ${options.map((value) => `<option value="${attr(value)}" ${record[field] === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}
  </select>`;
}

function pageRecordDetail(record) {
  const evaluation = recordEvaluation(record) || { items: [], reasons: [], pass: false, tol: 0.05 };
  const device = deviceById(record.device) || record.deviceSnapshot || {};
  const threshold = Number(state.data.settings?.confidenceThreshold || 0.9);
  const owner = state.data.user.id === record.inspector;
  const editable = owner && record.status === '待提交';
  const remarkEditable = owner && ['待提交', '已提交'].includes(record.status) && !isRole('verifier');
  const itemMap = new Map(evaluation.items.map((item) => [item.key, item]));
  const actionButtons = [];
  if (editable) {
    actionButtons.push(`<button class="btn btn-primary" data-action="submit-record" data-id="${attr(record.id)}">${icon('check')}一键提交</button>`);
  }
  if (isRole('verifier') && record.status === '已提交') {
    actionButtons.push(`<button class="btn btn-success" data-action="confirm-record" data-id="${attr(record.id)}">${icon('check')}电子签名确认</button>`);
    actionButtons.push(`<button class="btn btn-secondary" data-action="reject-record" data-id="${attr(record.id)}">退回修改</button>`);
  }
  if (isRole('admin') && record.status !== '已作废') {
    actionButtons.push(`<button class="btn btn-danger" data-action="void-record" data-id="${attr(record.id)}">作废记录</button>`);
  }
  actionButtons.push(`<button class="btn btn-secondary" data-action="export-record" data-id="${attr(record.id)}">${icon('download')}导出 PDF</button>`);
  actionButtons.push(`<a class="btn btn-secondary" href="#/print/record/${encodeURIComponent(record.id)}">${icon('printer')}打印预览</a>`);
  return `${pageHeader('记录详情', `${record.id} · ${record.date}`, `<a class="btn btn-ghost" href="#/records">返回列表</a>`)}
    <div class="detail-head">
      <div class="detail-title"><h1>${esc(record.device)} · ${esc(state.data.devices.find((item) => item.id === record.device)?.uniqueNo || '')}</h1>
        <p class="row row-wrap mt8">${tag(record.status)} ${tag(evaluation.conclusion)} <span class="muted">检验人员 ${esc(accountName(record.inspector))}</span></p></div>
      <div class="head-actions">${actionButtons.join('')}</div>
    </div>
    ${evaluationBanner(record)}
    <section class="card mt16">
      <div class="meta-grid">
        ${[
          ['科室', device.dept || record.deviceSnapshot?.dept || '—'],
          ['天平唯一号', device.uniqueNo || record.deviceSnapshot?.uniqueNo || '—'],
          ['Max', `${formatNumber(device.max || record.deviceSnapshot?.max, 0)} g`],
          ['d', `${formatNumber(device.d || record.deviceSnapshot?.d, 2)} mg`],
          ['内部校正方式', record.deviceSnapshot?.internalCal || device.internalCal || '—'],
          ['校验日期', record.date],
          ['拍摄开始时间', record.startTime],
          ['量程切换过程', device.ranges === 2
            ? (record.rangeTransition?.endOffsetSeconds !== undefined
              ? `${formatVideoOffset(record.rangeTransition.startOffsetSeconds)} → ${formatVideoOffset(record.rangeTransition.endOffsetSeconds)}`
              : '未保存过程段')
            : '单量程'],
          ['砝码盒编号', record.box || '—'],
          ['原始文件', record.file],
          ['文件大小', formatFileSize(record.fileSize)],
          ['SHA-256', record.sha],
          ['模板版本', record.templateVersion || '—']
        ].map(([label, value]) => `<div class="meta-item"><span>${esc(label)}</span><strong class="${label === 'SHA-256' ? 'mono' : ''}">${esc(value)}</strong></div>`).join('')}
      </div>
    </section>
    <div class="grid grid-3 mt16">
      <section class="card span-2">
        <div class="card-head"><div><h2>九次称量明细</h2><p>点击截图核验真实识别帧、显示屏框与帧内识别文本</p></div>
          <span class="muted small">容差 ${esc(evaluation.tol)}%</span></div>
        <div class="table-wrap"><table class="readout-table">
          <thead><tr><th>编号</th><th>量程</th><th>标称 L(g)</th><th>示值 I(g)</th><th>限度区间(g)</th><th>偏差(g)</th><th>测量时间</th><th>截图 / 置信度</th><th>状态</th><th></th></tr></thead>
          <tbody>${(record.readouts || []).map((readout, index) => {
            const key = readoutKey(readout, index);
            const item = itemMap.get(key) || {};
            const low = readout.conf == null || Number(readout.conf) < threshold;
            const unstable = readout.stable === false;
            const outLimit = item.inLimit === false;
            const checked = Boolean(record.checks?.[`RO:${key}`]);
            const dec = Number.isInteger(item.dec) ? item.dec : 4;
            const frameOffset = Number(readout.frame?.offsetSeconds ?? readout.off ?? 0);
            return `<tr class="${low ? 'low-conf' : ''} ${unstable ? 'unstable' : ''} ${outLimit ? 'out-limit' : ''}">
              <td><b class="mono">${esc(key)}</b><div class="muted small">L${Number(readout.point) + 1} · 第${Number(readout.idx)}次</div></td>
              <td>${esc(item.rangeLabel || (readout.range === 2 ? '低量程' : device.ranges === 2 ? '高量程' : '单量程'))}</td>
              <td class="value">${formatNumber(item.L ?? device.points?.[readout.point], dec)}</td>
              <td class="value">${formatNumber(item.value ?? readout.value, dec)}</td>
              <td class="value">${item.lim ? `${formatNumber(item.lim.lo, dec)} ~ ${formatNumber(item.lim.hi, dec)}` : '—'}</td>
              <td class="value">${item.dev == null ? '—' : `${Number(item.dev) > 0 ? '+' : ''}${formatNumber(item.dev, dec)}`}</td>
              <td class="num nowrap">${esc(formatDate(readout.time))}</td>
              <td>
                <div class="frame-cell">
                  ${readout.screenshot
                    ? `<button class="btn btn-ghost btn-sm" style="padding:0" data-action="frame-evidence" data-id="${attr(record.id)}" data-key="${attr(key)}" title="查看带识别框的真实视频帧"><img class="shot-thumb" src="/api/records/${encodeURIComponent(record.id)}/screenshots/${encodeURIComponent(readout.screenshot.split('/').pop())}" alt="${attr(key)} 识别帧" loading="lazy"></button>`
                    : '<span class="shot-placeholder">无识别帧</span>'}
                  <span class="frame-stamp">帧 ${formatVideoOffset(frameOffset)}</span>
                  <button class="btn btn-ghost btn-sm" style="padding:0;font-size:9px" data-action="jump-video" data-off="${frameOffset}">播放此帧</button>
                  ${confidenceMark(readout.conf, threshold)}
                </div>
              </td>
              <td>${unstable ? tag('读数不稳定', 'red') : outLimit ? tag('超限', 'red') : item.inLimit ? tag('在限内', 'green') : tag('待核')}</td>
              <td class="col-actions">
                <div class="btn-group">
                  ${low && !checked && editable ? `<button class="btn btn-ghost btn-sm" data-action="check-readout" data-id="${attr(record.id)}" data-key="${attr(key)}">标记已核</button>` : ''}
                  ${editable ? `<button class="btn btn-ghost btn-sm" data-action="edit-readout" data-id="${attr(record.id)}" data-key="${attr(key)}">修正</button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <div class="alert mt12">不稳定判定：连续不少于 3 秒且示值变化不超过 1 个显示分度值 d；取平台段最后有效读数。</div>
      </section>
      <aside class="stack">
        <section class="card">
          <div class="card-head"><div><h2>原始视频</h2><p>按需跳转到指定读数时间点</p></div></div>
          <div class="video-panel" id="video-panel">
            <video id="record-video" controls preload="metadata" src="/api/records/${encodeURIComponent(record.id)}/video"></video>
          </div>
          <p class="muted small mt8">若视频已按容量策略清理，记录、截图和审计信息仍完整可查。</p>
        </section>
        <section class="card">
          <div class="card-head"><h2>人工复核确认项</h2><span class="muted small">现场观察后确认</span></div>
          ${[
            ['cleanliness', '清洁', ['是', '否', 'NA']],
            ['level', '水平调节', ['是', '否', 'NA']],
            ['internalCal', '内部校正是否通过', ['是', '否', 'NA']]
          ].map(([field, label, options]) => `<div class="field-row mt8"><label>${esc(label)}</label>${fieldSelect(record, field, options, label)}</div>`).join('')}
          <div class="field mt12"><label>砝码盒编号 *</label>
            <input class="record-field" list="weight-box-list" data-record="${attr(record.id)}" data-field="box"
              value="${attr(record.box || '')}" ${editable ? '' : 'disabled'} placeholder="字母或数字，不超过 10 位">
            <datalist id="weight-box-list">${state.data.weightBoxes.filter((box) => box.status === '启用').map((box) => `<option value="${attr(box.id)}">${esc(box.remark || '')}</option>`).join('')}</datalist>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>备注</h2><span class="muted small">默认“无”</span></div>
          <textarea class="record-remark" data-record="${attr(record.id)}" ${remarkEditable ? '' : 'disabled'}>${esc(record.remark || '无')}</textarea>
          ${remarkEditable ? `<button class="btn btn-secondary btn-block mt8" data-action="save-remark" data-id="${attr(record.id)}">保存备注</button>` : ''}
          ${record.status === '已提交' ? '<p class="muted small mt8">已提交状态下仅备注可修改，修改留痕对复核人员可见。</p>' : ''}
        </section>
      </aside>
    </div>
    <div class="grid grid-2 mt16">
      <section class="card">
        <div class="card-head"><h2>确认与签名</h2></div>
        <div class="kv-list">
          <div class="kv"><span>校验人员签名</span><strong>${esc(record.submittedBy ? `${accountName(record.submittedBy)}（${record.submittedBy}） · ${formatDate(record.submittedAt)}` : '尚未提交')}</strong></div>
          <div class="kv"><span>提交来源</span><strong>${esc(record.submittedFrom || '—')}</strong></div>
          <div class="kv"><span>复核确认人</span><strong>${esc(record.verifiedBy ? `${accountName(record.verifiedBy)}（${record.verifiedBy}） · ${formatDate(record.verifiedAt)}` : '尚未复核')}</strong></div>
          <div class="kv"><span>复核来源</span><strong>${esc(record.verifiedFrom || '—')}</strong></div>
          ${record.rejectedAt ? `<div class="kv"><span>最近退回</span><strong>${esc(accountName(record.rejectedBy))} · ${esc(formatDate(record.rejectedAt))}<br>${esc(record.rejectReason || '未填写理由')}</strong></div>` : ''}
          ${record.voidAt ? `<div class="kv"><span>作废</span><strong>${esc(accountName(record.voidBy))} · ${esc(formatDate(record.voidAt))}<br>${esc(record.voidReason || '')}</strong></div>` : ''}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>修改与操作痕迹</h2><p>按时间顺序保留全部前后值与理由</p></div></div>
        <div class="trace-list">
          ${(record.modifications || []).length
            ? record.modifications.map((item) => `<div class="trace-item">
              <strong>${esc(item.field)}：${esc(item.before)} → ${esc(item.after)}</strong>
              <p>${esc(accountName(item.by))} · ${esc(formatDate(item.at))} · ${esc(item.stage || '')}<br>理由：${esc(item.reason || '未填写')}</p>
            </div>`).join('')
            : `<div class="empty" style="padding:20px"><strong>暂无字段修改</strong>提交、复核和导出动作另见审计日志。</div>`}
        </div>
      </section>
    </div>`;
}

async function loadHistoryRecords(deviceId, pageNumber = 1) {
  if (state.historyView.loading) return;
  const filter = state.filters.history;
  const page = Math.max(1, Number(pageNumber) || 1);
  state.historyView.device = deviceId;
  state.historyView.loading = true;
  state.historyView.error = '';
  if (parseRoute().path === `/history/${encodeURIComponent(deviceId)}`) render();
  const query = new URLSearchParams();
  query.append('devices', deviceId);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  if (filter.conclusion) query.set('conclusion', filter.conclusion);
  query.set('page', String(page));
  query.set('pageSize', '200');
  try {
    const result = await api(`/api/records?${query.toString()}`);
    state.historyView = {
      device: deviceId,
      loaded: true,
      loading: false,
      items: result.items || [],
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || 200),
      totalPages: Number(result.totalPages || 1),
      error: ''
    };
  } catch (error) {
    state.historyView = {
      ...state.historyView,
      device: deviceId,
      loaded: true,
      loading: false,
      error: errorMessage(error)
    };
  }
  if (parseRoute().path.startsWith('/history/')) render();
}

function historyTrendChart(records, device, point) {
  const ordered = [...records]
    .filter((record) => record.status !== '已作废')
    .sort((left, right) => (
      `${left.startTime || left.date} ${left.id}`.localeCompare(`${right.startTime || right.date} ${right.id}`)
    ));
  const nominal = Number(device.points?.[point]);
  const rows = ordered.map((record) => {
    const items = (recordEvaluation(record)?.items || [])
      .filter((item) => Number(item.point) === point && item.value !== null && Number.isFinite(Number(item.value)));
    return {
      record,
      items,
      mean: items.length
        ? items.reduce((sum, item) => sum + Number(item.value), 0) / items.length
        : null
    };
  }).filter((row) => row.items.length);
  if (!rows.length) {
    return `<div class="empty"><strong>L${point + 1} 暂无可绘制示值</strong>完成校验后会显示误差曲线。</div>`;
  }
  const deviations = rows.flatMap((row) => row.items.map((item) => (Number(item.value) - nominal) * 1000));
  const means = rows.map((row) => (row.mean - nominal) * 1000);
  const range = Number(device.pointRange?.[point]) === 2 ? device.range2 : device.range1;
  const dMg = Number(range?.d ?? device.d ?? 0.1);
  const maxDeviation = Math.max(...deviations.map(Math.abs), ...means.map(Math.abs), 0);
  const padding = Math.max((Math.max(...deviations) - Math.min(...deviations)) * 0.28, dMg * 1.5, 0.02);
  let yMin = Math.min(0, ...deviations) - padding;
  let yMax = Math.max(0, ...deviations) + padding;
  if (yMax - yMin < dMg * 2) {
    const center = (yMax + yMin) / 2;
    yMin = center - dMg;
    yMax = center + dMg;
  }
  const width = 760;
  const height = 238;
  const left = 62;
  const right = 18;
  const top = 18;
  const bottom = 45;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xAt = (index) => rows.length <= 1
    ? left + plotWidth / 2
    : left + (index / (rows.length - 1)) * plotWidth;
  const yAt = (value) => top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const axisDecimals = Math.abs(yMax - yMin) < 1 ? 2 : Math.abs(yMax - yMin) < 10 ? 1 : 0;
  const meanPoints = rows.map((row, index) => `${xAt(index)},${yAt((row.mean - nominal) * 1000)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  const toleranceMg = nominal * Number(recordEvaluation(rows[0].record)?.tol ?? device.tol ?? 0.05) / 100 * 1000;
  const toleranceOutside = toleranceMg > Math.max(yMax, Math.abs(yMin)) + 0.001;
  const pointColors = ['#0b8f7e', '#246da8', '#c17a17'];
  const circles = rows.map((row, index) => {
    const centerX = xAt(index);
    return row.items.map((item, itemIndex) => {
      const spread = (itemIndex - (row.items.length - 1) / 2) * 4;
      return `<circle cx="${(centerX + spread).toFixed(2)}" cy="${yAt((Number(item.value) - nominal) * 1000).toFixed(2)}" r="2.8" fill="${pointColors[point]}" fill-opacity=".62"><title>${esc(item.key)} ${esc(item.value)} g</title></circle>`;
    }).join('');
  }).join('');
  const dateLabels = rows.map((row, index) => {
    if (index % labelEvery !== 0 && index !== rows.length - 1) return '';
    const label = String(row.record.startTime || row.record.date).slice(5, 16).replace(' ', ' ');
    const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle';
    return `<text x="${xAt(index).toFixed(2)}" y="${height - 20}" fill="#617786" font-size="9" text-anchor="${anchor}">${esc(label)}</text>`;
  }).join('');
  return `<div class="trend-chart">
    <div class="trend-head"><strong>L${point + 1} · ${esc(nominal)} g</strong><span>纵轴按实测量差自动放大；点表示 3 次称量，折线表示均值</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="L${point + 1} 示值误差曲线，纵轴单位毫克">
      <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" rx="5" fill="#f8fbfc" stroke="#d7e1e7"/>
      ${ticks.map((tick) => `<line x1="${left}" y1="${yAt(tick).toFixed(2)}" x2="${left + plotWidth}" y2="${yAt(tick).toFixed(2)}" stroke="#dce5ea" stroke-dasharray="${Math.abs(tick) < 0.000001 ? '0' : '3 5'}"/><text x="${left - 9}" y="${(yAt(tick) + 3).toFixed(2)}" fill="#617786" font-size="9" text-anchor="end">${formatNumber(tick, axisDecimals)}</text>`).join('')}
      <line x1="${left}" y1="${yAt(0).toFixed(2)}" x2="${left + plotWidth}" y2="${yAt(0).toFixed(2)}" stroke="#526b7a" stroke-width="1.2"/>
      <polyline points="${meanPoints}" fill="none" stroke="${pointColors[point]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${circles}
      ${dateLabels}
      <text x="13" y="${top + plotHeight / 2}" fill="#405766" font-size="10" text-anchor="middle" transform="rotate(-90 13 ${top + plotHeight / 2})">示值误差（mg）</text>
    </svg>
    <p class="trend-note">本点最大绝对偏差 ${formatNumber(maxDeviation, axisDecimals)} mg，容差约 ±${formatNumber(toleranceMg, 2)} mg${toleranceOutside ? '（容差线超出本图自动缩放范围）' : ''}。图中 0 表示标称值。</p>
  </div>`;
}

function pageHistory(deviceId) {
  const device = deviceById(deviceId);
  if (!device) {
    return `${pageHeader('天平历史汇总', '未找到天平档案')}
      <section class="card"><div class="empty"><strong>天平 ${esc(deviceId)} 不存在</strong>请检查天平编号或返回记录列表。</div></section>`;
  }
  if (state.historyView.device !== deviceId || !state.historyView.loaded || state.historyView.loading) {
    return `${pageHeader(`${device.id} 历史汇总`, '正在读取历史记录…')}
      <section class="card"><div class="empty"><span class="spinner"></span>正在查询 ${esc(device.id)} 的历史记录</div></section>`;
  }
  const view = state.historyView;
  const records = [...view.items].sort((a, b) => b.date.localeCompare(a.date));
  const active = records.filter((record) => record.status !== '已作废');
  const abnormal = active.filter((record) => recordEvaluation(record)?.conclusion === '不通过');
  const currentWeek = naturalWeekRange();
  const filter = state.filters.history;
  return `${pageHeader(
    `${device.id} 历史汇总`,
    `${device.uniqueNo} · ${device.dept} · Max ${device.max}g / d ${device.d}mg`,
    `<a class="btn btn-secondary" href="#/print/week?device=${encodeURIComponent(device.id)}&week=${attr(currentWeek.week)}">${icon('printer')}本周打印</a>
     <button class="btn btn-secondary" data-action="history-csv" data-device="${attr(device.id)}">${icon('download')}示值明细 CSV</button>`
  )}
    <form class="card filterbar" data-form="history-filter">
      <div class="field"><label>开始日期</label><input type="date" name="from" value="${attr(filter.from)}"></div>
      <div class="field"><label>结束日期</label><input type="date" name="to" value="${attr(filter.to)}"></div>
      <div class="field"><label>判定结论</label><select name="conclusion">
        ${['', '通过', '不通过'].map((value) => `<option value="${value}" ${filter.conclusion === value ? 'selected' : ''}>${value || '全部结论'}</option>`).join('')}
      </select></div>
      <button class="btn btn-primary" type="submit">筛选历史</button>
      <button class="btn btn-secondary" type="button" data-action="reset-history-filter" data-device="${attr(device.id)}">重置</button>
    </form>
    ${view.error ? `<div class="alert danger mt12">${esc(view.error)}</div>` : ''}
    <div class="grid grid-4">
      ${[
        ['筛选记录', view.total, '服务端筛选总数'],
        ['有效记录', active.length, '已排除作废记录'],
        ['不合格记录', abnormal.length, '异常同样完成复核归档'],
        ['最近校验', records[0]?.date || '—', records[0] ? accountName(records[0].inspector) : '暂无记录']
      ].map(([label, value, note], index) => `
        <article class="card stat-card ${index === 2 ? 'amber' : 'teal'}">
          <div class="stat-label">${esc(label)}</div><div class="stat-value" style="${String(value).length > 8 ? 'font-size:20px' : ''}">${esc(value)}</div><div class="stat-note">${esc(note)}</div>
        </article>`).join('')}
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>历史记录</h2><p>按校验日期倒序显示；异常记录在判定列明确标注</p></div>
        <span class="muted small">第 ${view.page} / ${view.totalPages} 页</span></div>
      ${recordsTable(records)}
      <div class="row between mt12">
        <button class="btn btn-secondary btn-sm" data-action="history-page" data-device="${attr(device.id)}" data-page="${view.page - 1}" ${view.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn btn-secondary btn-sm" data-action="history-page" data-device="${attr(device.id)}" data-page="${view.page + 1}" ${view.page >= view.totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    </section>
    <section class="card mt16">
      <div class="card-head"><div><h2>示值误差曲线</h2><p>L1 / L2 / L3 分别自动缩放纵轴，突出每次称量的微小波动</p></div>${tag('单位 mg', 'blue')}</div>
      <div class="trend-grid">
        ${[0, 1, 2].map((point) => historyTrendChart(records, device, point)).join('')}
      </div>
    </section>
    <section class="card mt16">
      <div class="card-head"><div><h2>示值明细汇总</h2><p>按标称点列出历次示值与限内状态</p></div></div>
      ${records.length ? `<div class="table-wrap"><table class="readout-table">
        <thead><tr><th>日期 / 记录</th><th>L1 示值</th><th>L2 示值</th><th>L3 示值</th><th>结论</th><th>状态</th><th>异常说明</th></tr></thead>
        <tbody>${records.map((record) => {
          const evaluation = recordEvaluation(record);
          const groups = [0, 1, 2].map((point) => evaluation?.items?.filter((item) => item.point === point) || []);
          return `<tr class="${evaluation?.conclusion === '不通过' ? 'out-limit' : ''}">
            <td><a href="#/records/${encodeURIComponent(record.id)}" class="mono">${esc(record.date)}</a><div class="muted small">${esc(record.id)}</div></td>
            ${groups.map((group) => `<td class="value">${group.map((item) => `${formatNumber(item.value, item.dec)}<span class="${item.inLimit ? 'success-text' : 'danger-text'}">${item.inLimit ? '✓' : '!'}</span>`).join('<br>')}</td>`).join('')}
            <td>${tag(evaluation?.conclusion || '—')}</td>
            <td>${tag(record.status)}</td>
            <td class="small">${esc(evaluation?.reasons?.map((reason) => reason.label).join('、') || '无')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="empty"><strong>暂无历史数据</strong>完成首次校验后会显示示值汇总。</div>`}
    </section>`;
}

async function loadVerifyRecords(pageNumber = 1) {
  if (state.verifyView.loading) return;
  const filter = state.filters.verify;
  const page = Math.max(1, Number(pageNumber) || 1);
  state.verifyView.loading = true;
  state.verifyView.error = '';
  if (parseRoute().path === '/verify') render();
  const query = new URLSearchParams({ status: '已提交', page: String(page), pageSize: '100' });
  if (filter.device) query.set('devices', filter.device);
  if (filter.inspector) query.set('inspector', filter.inspector);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  try {
    const result = await api(`/api/records?${query.toString()}`);
    state.verifyView = {
      loaded: true,
      loading: false,
      items: result.items || [],
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || 100),
      totalPages: Number(result.totalPages || 1),
      error: ''
    };
  } catch (error) {
    state.verifyView = {
      ...state.verifyView,
      loaded: true,
      loading: false,
      error: errorMessage(error)
    };
  }
  if (parseRoute().path === '/verify') render();
}

function pageVerify() {
  const filter = state.filters.verify;
  const view = state.verifyView;
  if (!view.loaded || view.loading) {
    return `${pageHeader('待复核记录', '正在读取服务端待复核队列…')}
      <section class="card"><div class="empty"><span class="spinner"></span>正在查询待复核记录</div></section>`;
  }
  const pending = view.items;
  const inspectors = state.data.accounts.filter((account) => account.role === 'inspector');
  return `${pageHeader('待复核记录', '复核确认即电子签名。确认后全部字段锁定；发现问题可退回或按现行方式口头通知。')}
    <form class="card filterbar" data-form="verify-filter">
      <div class="field"><label>天平编号</label><select name="device">
        <option value="">全部天平</option>
        ${state.data.devices.map((device) => `<option value="${attr(device.id)}" ${filter.device === device.id ? 'selected' : ''}>${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
      </select></div>
      <div class="field"><label>检验人员</label><select name="inspector">
        <option value="">全部人员</option>
        ${inspectors.map((account) => `<option value="${attr(account.id)}" ${filter.inspector === account.id ? 'selected' : ''}>${esc(account.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>校验开始日期</label><input type="date" name="from" value="${attr(filter.from)}"></div>
      <div class="field"><label>校验结束日期</label><input type="date" name="to" value="${attr(filter.to)}"></div>
      <button class="btn btn-primary" type="submit">筛选</button>
      <button class="btn btn-secondary" type="button" data-action="reset-verify-filter">重置</button>
    </form>
    <div class="alert warn">${view.total} 条已提交记录等待复核。低置信字段、修改痕迹和原始视频均应在签名前检查。</div>
    ${view.error ? `<div class="alert danger">${esc(view.error)}</div>` : ''}
    <div class="cards-grid mt16">
      ${pending.length ? pending.map((record) => {
        const evaluation = recordEvaluation(record);
        const lowCount = record.readouts.filter((readout) => Number(readout.conf) < Number(state.data.settings.confidenceThreshold || 0.9)).length;
        return `<article class="card">
          <div class="row between"><div><span class="muted small">${esc(accountName(record.inspector))} 提交</span><h3 style="margin:3px 0">${esc(record.id)}</h3></div>${tag(evaluation?.conclusion || '—')}</div>
          <div class="kv-list mt8">
            <div class="kv"><span>天平</span><strong>${esc(record.device)} · ${esc(deviceById(record.device)?.uniqueNo || '')}</strong></div>
            <div class="kv"><span>校验日期</span><strong>${esc(record.date)}</strong></div>
            <div class="kv"><span>砝码盒</span><strong>${esc(record.box || '—')}</strong></div>
            <div class="kv"><span>提交时间</span><strong>${esc(formatDate(record.submittedAt))}</strong></div>
          </div>
          ${lowCount ? `<div class="alert warn mt8">${lowCount} 个读数置信度偏低，检验员已核对后才能提交。</div>` : `<div class="alert success mt8">识别字段均已核对，可查看证据后签名。</div>`}
          <div class="btn-group mt12">
            <a class="btn btn-primary btn-sm" href="#/records/${encodeURIComponent(record.id)}">${icon('eye')}查看并复核</a>
          </div>
        </article>`;
      }).join('') : `<div class="card"><div class="empty"><strong>待复核队列已清空</strong>没有符合当前筛选条件的已提交记录。</div></div>`}
    </div>
    <div class="row between mt16">
      <button class="btn btn-secondary btn-sm" data-action="verify-page" data-page="${view.page - 1}" ${view.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="muted small">第 ${view.page} / ${view.totalPages} 页 · 每页 ${view.pageSize} 条</span>
      <button class="btn btn-secondary btn-sm" data-action="verify-page" data-page="${view.page + 1}" ${view.page >= view.totalPages ? 'disabled' : ''}>下一页</button>
    </div>`;
}

function pageDeviceDirectory() {
  const queryText = String(state.ui.deviceDirectoryQuery || '').trim().toUpperCase();
  const allDevices = state.data.devices || [];
  const devices = allDevices.filter((device) => !queryText || [
    device.id,
    device.uniqueNo,
    device.dept,
    device.defaultBox,
    ...(device.points || [])
  ].some((value) => String(value || '').toUpperCase().includes(queryText)));
  const activeCount = allDevices.filter((device) => device.status === '在用').length;
  const latestRecord = (deviceId) => (state.data.records || [])
    .filter((record) => record.device === deviceId)
    .sort((left, right) => String(right.startTime || right.date).localeCompare(String(left.startTime || left.date)))[0];
  return `${pageHeader(
    '天平档案',
    '只读查询设备编号、量程、参考点、容差和最近校验记录。',
    ''
  )}
    <div class="grid grid-4">
      ${[
        ['档案总数', allDevices.length, '已登记天平'],
        ['在用设备', activeCount, '可用于新校验'],
        ['停用设备', allDevices.length - activeCount, '仅供历史查询'],
        ['查询结果', devices.length, queryText ? `关键词：${queryText}` : '当前显示全部']
      ].map(([label, value, note]) => `<article class="card stat-card teal">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value">${Number(value)}</div>
        <div class="stat-note">${esc(note)}</div>
      </article>`).join('')}
    </div>
    <form class="card filterbar mt16" data-form="device-directory-search">
      <div class="field grow"><label for="device-directory-query">天平编号 / 唯一号 / 科室</label>
        <input id="device-directory-query" name="query" value="${attr(state.ui.deviceDirectoryQuery)}" placeholder="输入编号、唯一号或科室进行查询">
      </div>
      <button class="btn btn-primary" type="submit">${icon('eye')}查询</button>
      <button class="btn btn-secondary" type="button" data-action="device-directory-reset">清除</button>
    </form>
    <section class="card mt16">
      <div class="card-head"><div><h2>设备列表</h2><p>检验人员可查看档案并进入历史曲线或设备二维码</p></div>${tag(`${devices.length} 台`, 'blue')}</div>
      <div class="table-wrap desktop-table"><table>
        <thead><tr><th>天平编号</th><th>唯一号 / 科室</th><th>量程与分度值</th><th>参考点</th><th>容差</th><th>默认砝码盒</th><th>最近校验</th><th>状态</th><th class="col-actions">操作</th></tr></thead>
        <tbody>${devices.map((device) => {
          const latest = latestRecord(device.id);
          return `<tr class="${device.status === '停用' ? 'row-muted' : ''}">
            <td><b class="mono">${esc(device.id)}</b><div class="muted small">${esc(device.qrContent)}</div></td>
            <td>${esc(device.uniqueNo)}<div class="muted small">${esc(device.dept)}</div></td>
            <td>${device.ranges === 2
              ? `${esc(device.range1.max)}g / ${esc(device.range1.d)}mg<br><span class="muted small">${esc(device.range2.max)}g / ${esc(device.range2.d)}mg</span>`
              : `${esc(device.range1.max)}g / ${esc(device.range1.d)}mg`}</td>
            <td class="num">${(device.points || []).map((point) => `${esc(point)}g`).join(' / ')}</td>
            <td class="num">±${esc(device.tol)}%</td>
            <td class="mono">${esc(device.defaultBox || '—')}</td>
            <td>${latest ? `${esc(latest.date)}<div class="muted small">${esc(latest.status)} · ${esc(latest.id)}</div>` : '<span class="muted">暂无记录</span>'}</td>
            <td>${tag(device.status)}</td>
            <td class="col-actions"><div class="btn-group">
              <a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史曲线</a>
              ${device.status === '在用' ? `<a class="btn btn-ghost btn-sm" href="#/qr?device=${encodeURIComponent(device.id)}">设备二维码</a>` : '<span class="muted small">停用设备不生成新卡</span>'}
            </div></td>
          </tr>`;
        }).join('') || '<tr><td colspan="9"><div class="empty">没有符合查询条件的天平档案</div></td></tr>'}</tbody>
      </table></div>
      <div class="card-list">${devices.map((device) => {
        const latest = latestRecord(device.id);
        return `<article class="info-card">
          <div class="row between"><strong>${esc(device.id)} · ${esc(device.dept)}</strong>${tag(device.status)}</div>
          <p>${esc(device.uniqueNo)} · ${esc(device.points?.join(' / ') || '')}g · 容差 ±${esc(device.tol)}%</p>
          <p>默认砝码盒：${esc(device.defaultBox || '—')} · 最近校验：${latest ? `${esc(latest.date)} ${esc(latest.status)}` : '暂无'}</p>
          <div class="btn-group mt8"><a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史曲线</a>${device.status === '在用' ? `<a class="btn btn-ghost btn-sm" href="#/qr?device=${encodeURIComponent(device.id)}">设备二维码</a>` : '<span class="muted small">停用设备不生成新卡</span>'}</div>
        </article>`;
      }).join('') || '<div class="empty">没有符合查询条件的天平档案</div>'}</div>
    </section>`;
}

function pageMasterData() {
  const devices = state.data.devices;
  const boxes = state.data.weightBoxes;
  const dictionaries = state.data.dictionaries || [];
  const dictionaryLabels = {
    department: '科室',
    internal_cal: '内部校正方式',
    device_numbering_rule: '天平编号规则'
  };
  const write = can('masterdata.write');
  const devicesContent = `
    <div class="table-wrap desktop-table"><table>
      <thead><tr><th>天平编号</th><th>唯一号 / 科室</th><th>量程与精度</th><th>参考砝码</th><th>容差</th><th>状态</th><th class="col-actions">操作</th></tr></thead>
      <tbody>${devices.map((device) => `
        <tr class="${device.status === '停用' ? 'row-muted' : ''}">
          <td><b>${esc(device.id)}</b><div class="muted small">${esc(device.qrContent)} QR</div></td>
          <td>${esc(device.uniqueNo)}<div class="muted small">${esc(device.dept)}</div></td>
          <td>${device.ranges === 2
            ? `${esc(device.range1.max)}g / ${esc(device.range1.d)}mg<br><span class="muted small">${esc(device.range2.max)}g / ${esc(device.range2.d)}mg</span>`
            : `${esc(device.range1.max)}g / ${esc(device.range1.d)}mg`}</td>
          <td class="num">${device.points.map((point) => `${esc(point)}g`).join(' / ')}</td>
          <td class="num">${esc(device.tol)}%</td>
          <td>${tag(device.status)}</td>
          <td class="col-actions"><div class="btn-group">
            ${write ? `<button class="btn btn-ghost btn-sm" data-action="device-edit" data-id="${attr(device.id)}">编辑</button>` : ''}
            ${isRole('admin') ? `<button class="btn btn-ghost btn-sm" data-action="qr-download-device" data-id="${attr(device.id)}">设备二维码</button>` : ''}
            <a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史</a>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-list">${devices.map((device) => `
      <div class="info-card">
        <div class="row between"><strong>${esc(device.id)} · ${esc(device.dept)}</strong>${tag(device.status)}</div>
        <p>${esc(device.uniqueNo)} · ${device.ranges === 2 ? '双量程' : '单量程'} · ${esc(device.points.join(' / '))}g</p>
        <div class="btn-group mt8"><a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史</a>${write ? `<button class="btn btn-ghost btn-sm" data-action="device-edit" data-id="${attr(device.id)}">编辑</button>` : ''}${isRole('admin') ? `<button class="btn btn-ghost btn-sm" data-action="qr-download-device" data-id="${attr(device.id)}">设备二维码</button>` : ''}</div>
      </div>`).join('')}</div>`;
  const boxesContent = `
    <div class="cards-grid">
      ${boxes.length ? boxes.map((box) => `<article class="info-card">
        <div class="row between"><h3 class="mono">${esc(box.id)}</h3>${tag(box.status)}</div>
        <p class="mt8">${esc(box.remark || '无备注')}</p>
        <p>最近使用：${esc(box.lastUse || '—')}</p>
        ${write ? `<button class="btn btn-ghost btn-sm mt8" data-action="box-edit" data-id="${attr(box.id)}">编辑字典项</button>` : ''}
      </article>`).join('') : `<div class="card"><div class="empty">暂无砝码盒字典项</div></div>`}
    </div>`;
  const dictionariesContent = `
    <div class="table-wrap"><table>
      <thead><tr><th>类别</th><th>字典值</th><th>显示名称</th><th>排序</th><th>状态</th><th>备注</th><th class="col-actions">操作</th></tr></thead>
      <tbody>${dictionaries.map((item) => `<tr class="${item.status === '停用' ? 'row-muted' : ''}">
        <td>${esc(dictionaryLabels[item.category] || item.category)}</td>
        <td class="mono">${esc(item.value)}</td>
        <td>${esc(item.label)}</td>
        <td class="num">${Number(item.sortOrder || 0)}</td>
        <td>${tag(item.status)}</td>
        <td class="small">${esc(item.remark || '—')}</td>
        <td class="col-actions">${write ? `<button class="btn btn-ghost btn-sm" data-action="dictionary-edit" data-id="${attr(item.id)}">编辑</button>` : '只读'}</td>
      </tr>`).join('') || '<tr><td colspan="7"><div class="empty">暂无数据字典项</div></td></tr>'}</tbody>
    </table></div>`;
  return `${pageHeader(
    '天平档案与基础数据字典',
    '天平编号唯一；科室、内部校正方式、编号规则与砝码盒集中维护。',
    write ? `<button class="btn btn-primary" data-action="device-new">${icon('plus')}新建天平</button>
      <button class="btn btn-secondary" data-action="box-new">${icon('plus')}新增砝码盒</button>
      <button class="btn btn-secondary" data-action="dictionary-new">${icon('plus')}新增字典项</button>
      <button class="btn btn-secondary" data-action="export-devices-csv">${icon('download')}天平清单</button>` : ''
  )}
    <div class="row between">
      <div class="tabs">
        <button class="tab ${state.ui.masterTab === 'devices' ? 'active' : ''}" data-action="master-tab" data-tab="devices">天平档案 ${devices.length}</button>
        <button class="tab ${state.ui.masterTab === 'boxes' ? 'active' : ''}" data-action="master-tab" data-tab="boxes">砝码盒字典 ${boxes.length}</button>
        <button class="tab ${state.ui.masterTab === 'dictionaries' ? 'active' : ''}" data-action="master-tab" data-tab="dictionaries">基础数据字典 ${dictionaries.length}</button>
      </div>
    </div>
    <section class="card mt12">
      <div class="card-head"><div><h2>${state.ui.masterTab === 'devices' ? '天平档案' : state.ui.masterTab === 'boxes' ? '砝码盒字典' : '基础数据字典'}</h2>
        <p>${state.ui.masterTab === 'devices' ? '限度=(1±容差%)×L，小数位按对应量程分度值对齐' : state.ui.masterTab === 'boxes' ? '编号仅含字母与数字，最多 10 位' : '编号规则使用 {seq:03} 或 %03d 表示流水号'}</p></div>
      </div>
      ${state.ui.masterTab === 'devices' ? devicesContent : state.ui.masterTab === 'boxes' ? boxesContent : dictionariesContent}
    </section>`;
}

function pageTemplate() {
  const write = can('template.write');
  const template = state.data.template;
  const fields = template.fields || [];
  return `${pageHeader('记录模板配置', `当前版本 ${template.version}。每次保存生成新版本，仅对新记录生效。`, '')}
    <div class="grid grid-3">
      <form class="card span-2" data-form="template-save">
        <div class="card-head"><div><h2>模板参数</h2><p>固定纸质表结构不可拖拽重排，仅调整允许项</p></div>${tag(template.version, 'violet')}</div>
        <div class="form-grid">
          <div class="field"><label>容差系数（%）</label><input type="number" name="tol" min="0.001" max="10" step="0.001" value="${attr(template.tol)}" ${write ? '' : 'disabled'}></div>
          ${(template.points || [200, 50, 10]).map((point, index) => `<div class="field"><label>L${index + 1} 标称点（g）</label><input type="number" name="point${index + 1}" min="0.000001" step="any" value="${attr(point)}" ${write ? '' : 'disabled'}></div>`).join('')}
          <div class="field"><label>测量时间</label>
            <label class="row" style="min-height:38px"><input type="checkbox" name="printTime" ${template.printTime !== false ? 'checked' : ''} ${write ? '' : 'disabled'}> 在导出与打印中显示测量时间行</label>
          </div>
          <div class="field full"><label class="row" style="min-height:38px"><input type="checkbox" name="useTemplatePoints" ${template.useTemplatePoints === true ? 'checked' : ''} ${write ? '' : 'disabled'}> 新记录判定使用模板标称点（默认使用各天平档案标称点）</label></div>
          <div class="field full"><label>页脚说明</label><textarea name="footerNote" ${write ? '' : 'disabled'}>${esc(template.footerNote || '')}</textarea></div>
          <div class="field full"><label>判定依据说明</label><textarea name="footerExtra" ${write ? '' : 'disabled'}>${esc(template.footerExtra || '')}</textarea></div>
        </div>
        <h3 class="section-title mt24">字段显示与名称</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>字段</th><th>显示</th><th>显示名称</th><th>说明</th></tr></thead>
          <tbody>${fields.map((field, index) => `<tr>
            <td class="mono">${esc(field.key)}</td>
            <td><input type="checkbox" name="show_${attr(field.key)}" ${field.show !== false ? 'checked' : ''} ${field.locked || !write ? 'disabled' : ''}></td>
            <td><input name="label_${attr(field.key)}" value="${attr(field.label || '')}" ${field.locked || !write ? 'disabled' : ''}></td>
            <td class="muted small">${field.locked ? '固定合规字段' : '可配置字段'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${write ? `<div class="row row-wrap mt16">
          <button class="btn btn-primary" type="submit">${icon('template')}保存为新版本</button>
          <button class="btn btn-secondary" type="button" data-action="template-reset">恢复默认模板</button>
        </div>` : '<div class="alert mt16">当前角色仅可查看模板配置。</div>'}
      </form>
      <aside class="stack">
        <section class="card">
          <div class="card-head"><div><h2>即时预览</h2><p>反映尚未保存的字段、页脚与测量时间设置</p></div></div>
          <div class="template-preview" data-template-preview>
            <div class="template-preview-title">电子天平日常校验记录表</div>
            <div class="template-preview-grid" data-preview-fields>
              ${fields.filter((field) => field.show !== false && !['time', 'detail'].includes(field.key))
                .map((field) => `<span>${esc(field.label)}</span><b>示例</b>`).join('')}
            </div>
            <div class="muted small" data-preview-points>${(template.points || [200, 50, 10]).map((point, index) => `L${index + 1}=${esc(point)}g`).join(' · ')} · ${template.useTemplatePoints === true ? '判定使用模板值' : '判定使用设备档案值'}</div>
            <div class="muted small" data-preview-time>${fields.find((field) => field.key === 'time')?.show === false || template.printTime === false ? '不打印测量时间' : `打印测量时间：${esc(fields.find((field) => field.key === 'time')?.label || '测量时间')}`}</div>
            <div class="muted small" data-preview-footer>${esc(template.footerExtra || template.footerNote || '')}</div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>版本历史</h2></div>
          <div class="trace-list">
            ${(state.data.templateVersions || []).map((version) => `<div class="trace-item">
              <strong>${esc(version.version)} · ${esc(version.summary || '模板调整')}</strong>
              <p>${esc(accountName(version.createdBy))} · ${esc(formatDate(version.createdAt))}</p>
            </div>`).join('') || '<div class="empty">暂无版本记录</div>'}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>安全约束</h2></div>
          <div class="account-note">已复核确认记录保存生成时的模板快照。后续修改内容和导出版式不会改变历史记录。</div>
          <div class="alert warn mt12">恢复默认模板需二次确认，动作写入不可编辑的审计日志。</div>
        </section>
      </aside>
    </div>`;
}

function pageExport() {
  const devices = state.data.devices;
  const defaultDevice = devices.find((device) => device.status === '在用')?.id || devices[0]?.id || '';
  const defaultFrom = daysAgoText(30);
  const defaultTo = todayText();
  const week = naturalWeekRange();
  return `${pageHeader('导出与打印', '正式 PDF 仅对已复核确认记录无水印；其他状态带“未复核”标记，作废记录带“已作废”水印。')}
    <div class="grid grid-3">
      <form class="card span-2" data-form="export-batch">
        <div class="card-head"><div><h2>校验记录批量导出</h2><p>可选择多台天平并按日期段合并 PDF</p></div>${tag('A4', 'blue')}</div>
        <div class="field"><label>天平编号（可多选）</label>
          <div class="cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(145px,1fr))">
            ${devices.map((device) => `<label class="info-card row" style="padding:9px 11px">
              <input type="checkbox" name="devices" value="${attr(device.id)}" ${device.id === defaultDevice ? 'checked' : ''}>
              <span><strong>${esc(device.id)}</strong><br><small class="muted">${esc(device.uniqueNo)}</small></span>
            </label>`).join('')}
          </div>
        </div>
        <div class="form-grid mt16">
          <div class="field"><label>开始日期</label><input type="date" name="from" value="${attr(defaultFrom)}" required></div>
          <div class="field"><label>结束日期</label><input type="date" name="to" value="${attr(defaultTo)}" required></div>
          <div class="field full"><label>分文件方式</label>
            <select name="mode">
              <option value="merged">合并为一个 PDF</option>
              <option value="per-device-day">每台天平每日一个 PDF（ZIP 文件包）</option>
            </select>
          </div>
          <label class="row full" style="font-size:11px"><input type="checkbox" name="includeUnverified"> 同时包含待提交/已提交记录（导出件自动加水印）</label>
        </div>
        <div class="row row-wrap mt16">
          <button type="submit" class="btn btn-primary">${icon('download')}生成批量 PDF</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv" data-type="records">${icon('file')}记录清单 CSV</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv" data-type="readouts">${icon('file')}示值明细 CSV</button>
        </div>
      </form>
      <form class="card" data-form="export-week">
        <div class="card-head"><div><h2>周统计表</h2><p>同一自然周按实际有记录日期成列</p></div>${tag('横向 A4', 'violet')}</div>
        <div class="field"><label>单台天平</label><select name="device" required>
          ${devices.filter((device) => device.status === '在用').map((device) => `<option value="${attr(device.id)}">${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
        </select></div>
        <div class="field mt12"><label>校验周</label><input type="week" name="week" value="${attr(week.week)}" required>
          <p class="muted small mt8" data-week-range>当前：${esc(week.from)} 至 ${esc(week.to)}（周一至周日）</p>
        </div>
        <button class="btn btn-primary btn-block mt16" type="submit">${icon('printer')}生成周统计 PDF</button>
        <button class="btn btn-secondary btn-block mt8" type="button" data-action="preview-week">${icon('eye')}预览选中的周</button>
      </form>
    </div>
    <section class="card mt16">
      <div class="card-head"><h2>近期导出记录</h2><span class="muted small">由服务端记录导出范围、条数和文件名</span></div>
      <div class="table-wrap desktop-table"><table>
        <thead><tr><th>时间</th><th>类型</th><th>范围</th><th>条数</th><th>文件名</th><th>操作人</th></tr></thead>
        <tbody>${(state.data.exports || []).map((item) => `<tr>
          <td class="num">${esc(formatDate(item.time))}</td><td>${tag(item.type, 'blue')}</td>
          <td>${esc(item.scope)}</td><td>${Number(item.count || 0)}</td><td class="mono">${esc(item.fileName || item.file || '—')}</td><td>${esc(accountName(item.by))}</td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty">暂无导出历史</div></td></tr>'}</tbody>
      </table></div>
      <div class="card-list">${(state.data.exports || []).map((item) => `<div class="info-card">
        <div class="row between"><strong>${esc(item.type)}</strong><span class="muted small">${esc(formatDate(item.time))}</span></div>
        <p>${esc(item.scope)} · ${Number(item.count || 0)} 条</p><p class="mono">${esc(item.fileName || item.file || '')}</p>
      </div>`).join('') || '<div class="empty">暂无导出历史</div>'}</div>
    </section>
    <section class="card mt16">
      <div class="card-head"><div><h2>${isRole('inspector') ? '二维码与空白表' : isRole('verifier') ? '设备二维码与空白表' : '空白记录表'}</h2><p>${isRole('inspector') ? '下载本人卡片；按天平编号或唯一号查询设备卡' : isRole('verifier') ? '按天平编号或唯一号查询并打印设备卡' : '空白表预览与下载使用同一份 PDF'}</p></div></div>
      <div class="row row-wrap mt12">
        ${isRole('inspector') || isRole('verifier') ? `<a class="btn btn-primary" href="#/qr">${icon('qr')}${isRole('inspector') ? '打开二维码中心' : '查询设备二维码'}</a>` : ''}
        <a class="btn btn-secondary" href="#/print/blank">${icon('printer')}打印空白记录表</a>
      </div>
    </section>`;
}

function pageQr() {
  const user = state.data.user;
  const showPersonalQr = isRole('inspector');
  const devices = state.data.devices.filter((device) => device.status === '在用');
  const requestedDevice = parseRoute().query.get('device') || '';
  const selectedId = devices.some((device) => device.id === requestedDevice)
    ? requestedDevice
    : devices.some((device) => device.id === state.ui.qrDevice)
      ? state.ui.qrDevice
      : devices[0]?.id;
  const device = devices.find((item) => item.id === selectedId) || null;
  return `${pageHeader(
    showPersonalQr ? '二维码中心' : '设备二维码',
    showPersonalQr ? '检验人员导出本人身份卡，并按编号查询天平设备卡。' : '按天平编号或唯一号查询并打印设备二维码。',
    `<a class="btn btn-secondary" href="#/help">${icon('help')}查看操作流程</a>`)}
    <div class="alert">二维码内容只包含${showPersonalQr ? '人员账号或' : ''}天平编号，不包含姓名、口令等敏感信息。卡片使用 H 级纠错，编号采用大号字体，便于长期张贴和视频识别。</div>
    <div class="grid ${showPersonalQr ? 'grid-2' : 'grid-1'} mt16">
      ${showPersonalQr ? `<section class="card qr-card-panel">
        <div class="card-head"><div><h2>我的人员二维码</h2><p>每名人员只能下载自己的身份卡</p></div>${tag('本人专用', 'green')}</div>
        <div class="identity-badge person">
          <img class="qr-card-image" src="/api/qr/person.svg?account=${encodeURIComponent(user.id)}" alt="${attr(user.id)} 人员二维码">
          <div class="qr-side-label"><span>人员身份识别码</span><strong>${esc(user.id)}</strong><b>${esc(user.name)} · ${esc(roleLabel(user.role))}</b><small>校验前请将本人卡片出示给镜头，不得转借。</small></div>
        </div>
        <div class="row row-wrap mt16">
          <button class="btn btn-primary" data-action="qr-download-person">${icon('download')}下载 SVG 卡片</button>
          <button class="btn btn-secondary" data-action="qr-download-person-png">${icon('download')}下载 PNG</button>
          <a class="btn btn-secondary" href="#/print/qr?type=person">${icon('printer')}打印卡片</a>
        </div>
      </section>` : ''}
      <section class="card qr-card-panel">
        <div class="card-head"><div><h2>天平设备二维码</h2><p>按天平编号或唯一号查询，再导出用于张贴</p></div>${tag('长期张贴', 'blue')}</div>
        <form class="qr-search" data-form="qr-device-search">
          <div class="field grow"><label for="qr-device-query">天平编号 / 唯一号</label><input id="qr-device-query" name="deviceQuery" required value="${attr(device?.id || '')}" list="qr-device-options" placeholder="例如 F001 或 DZTP170911C"></div>
          <datalist id="qr-device-options">${devices.map((item) => `<option value="${attr(item.id)}">${esc(item.uniqueNo)} · ${esc(item.dept)}</option>`).join('')}</datalist>
          <button class="btn btn-primary" type="submit">查询</button>
        </form>
        ${device ? `<div class="identity-badge device">
          <img class="qr-card-image" src="/api/qr/device/${encodeURIComponent(device.id)}.svg" alt="${attr(device.id)} 天平二维码">
          <div class="qr-side-label"><span>天平设备识别码</span><strong>${esc(device.id)}</strong><b>${esc(device.uniqueNo)} · ${esc(device.dept)}</b><small>扫描用于核对天平身份。请长期固定在设备正面或侧面，保持平整、无遮挡。</small></div>
        </div>
        <div class="row row-wrap mt16">
          <button class="btn btn-primary" data-action="qr-download-device" data-id="${attr(device.id)}">${icon('download')}下载 SVG 卡片</button>
          <button class="btn btn-secondary" data-action="qr-download-device-png" data-id="${attr(device.id)}">${icon('download')}下载 PNG</button>
          <a class="btn btn-secondary" href="#/print/qr?type=device&id=${encodeURIComponent(device.id)}">${icon('printer')}打印卡片</a>
        </div>` : '<div class="empty"><strong>暂无在用天平</strong>请先由复核确认人员建立天平档案。</div>'}
      </section>
    </div>
    <section class="card mt16">
      <div class="card-head"><h2>张贴与拍摄要求</h2></div>
      <div class="qr-guidance-grid">
        <div><b>设备卡</b><span>贴在天平正面显示屏旁，不遮住水平泡、按键或显示屏。设备卡可长期在画面中。</span></div>
        <div><b>人员卡</b><span>开始校验时由本人出示，停留至少 2 秒。人员卡与设备卡同屏出现是允许的。</span></div>
        <div><b>打印尺寸</b><span>建议卡片宽度不小于 70 mm；二维码本体不小于 40 mm × 40 mm。</span></div>
      </div>
    </section>`;
}

function pageHelp() {
  const role = state.data.user.role;
  return `${pageHeader('标准操作流程', '建议首次使用前完整阅读；可下载 PDF 或直接打印。',
    `<button class="btn btn-primary" data-action="download-sop">${icon('download')}下载 PDF</button>
     <a class="btn btn-secondary" href="#/print/sop">${icon('printer')}预览与打印 PDF</a>`)}
    <section class="card sop-intro">
      <div class="sop-number">01</div>
      <div><h2>开始前准备</h2><p>确认电脑已连接内网，摄像头或固定手机支架已就位，天平开机并完成水平调节。人员二维码由本人保存；设备二维码应长期贴在天平上。</p></div>
    </section>
    <div class="sop-steps">
      ${[
        ['02', '确认身份', '登录系统后进入“二维码”，人员下载自己的身份卡并在镜头前出示；检验人员查询并打印对应天平设备卡。'],
        ['03', '拍摄校验视频', '画面需同时覆盖天平显示屏、称重仓和身份卡。设备卡长期可见不影响人员卡识别。每次读数稳定停留至少 3 秒。'],
        ['04', '上传并等待分析', '选择 MP4 / MOV 视频，确认拍摄时间后上传。任务按顺序自动分析；失败或待人工处理时查看原因。'],
        ['05', '核对九次称重', '打开待提交记录，逐项核对真实识别帧、示值、低置信提示和缺次状态。修正错误必须填写理由。'],
        ['06', '确认观察项并提交', '人工确认清洁、水平调节、内部校正是否通过和砝码盒编号。点击提交即完成电子确认。'],
        ['07', '复核与归档', '复核确认人员检查证据后确认或退回。确认后的记录锁定；正式 PDF 可用于打印留档。']
      ].map(([number, title, text]) => `<article class="card sop-step"><span>${number}</span><div><h3>${esc(title)}</h3><p>${esc(text)}</p></div></article>`).join('')}
    </div>
    <div class="grid grid-2 mt16">
      <section class="card">
        <div class="card-head"><h2>${isRole('inspector') ? '检验人员操作要点' : isRole('verifier') ? '复核确认人员操作要点' : '管理员操作要点'}</h2></div>
        <ol class="sop-list">
          ${role === 'inspector' ? `
            <li>只上传本人完成的校验视频，人员卡必须与登录账号一致。</li>
            <li>双量程天平先完成高量程三次，再切换量程完成低量程六次。</li>
            <li>提交前处理全部低置信或缺失读数提示；不通过记录也需提交归档。</li>
            <li>在“校验记录”选择天平查看历史趋势和自动缩放的误差曲线。</li>`
          : role === 'verifier' ? `
            <li>优先核对视频、九次识别帧、限值、偏差和修改理由。</li>
            <li>确认即电子签名并锁定记录；退回时必须写明修改要求。</li>
            <li>维护天平、砝码盒和记录模板；设备二维码由检验人员按需导出。</li>
            <li>周统计表直接选择一个自然周，避免手工填写起止日期。</li>`
          : `
            <li>管理账号、天平档案、模板、队列、备份、容量和审计日志。</li>
            <li>运行状态页按“每台在用天平每天 1 段”预估视频可存储时长。</li>
            <li>下载操作流程 PDF 并组织三类角色培训。</li>
            <li>管理员操作同样写入审计日志；不得修改已确认记录。</li>`}
        </ol>
      </section>
      <section class="card">
        <div class="card-head"><h2>常见问题</h2></div>
        <div class="faq-list">
          <details><summary>人员卡和设备卡能否同屏？</summary><p>可以。分析器会在一帧内检测多个二维码，也会跨多个抽样帧合并身份；只要最终各识别到唯一且一致的有效卡片即可。</p></details>
          <details><summary>读数波动很小，图上看不出来怎么办？</summary><p>历史页使用“示值误差（mg）”作为纵轴，并按当前天平的实测波动自动缩放，不把曲线压在 0～Max 的大范围中。</p></details>
          <details><summary>为什么自动记录还要人工确认清洁和水平？</summary><p>当前系统以视觉读数识别为主，已移除语音识别依赖。清洁、水平调节和内部校正结果由操作人员现场观察后确认。</p></details>
          <details><summary>口令输错很多次会锁定吗？</summary><p>不会锁定，可以无限次重试。错误达到 5 次后，每次登录均需输入图中验证码。</p></details>
        </div>
      </section>
    </div>`;
}

function pagePrintQr() {
  const query = parseRoute().query;
  const type = query.get('type') === 'device' ? 'device' : 'person';
  const user = state.data.user;
  if (type === 'person' && !isRole('inspector')) {
    return '<div class="print-toolbar app-only"><a class="btn btn-secondary" href="#/qr">返回设备二维码</a></div><section class="card"><div class="empty"><strong>复核确认人员没有个人二维码</strong>可直接返回设备二维码页查询或补打设备卡。</div></section>';
  }
  const device = type === 'device' ? deviceById(query.get('id') || '') : null;
  if (type === 'device' && !device) {
    return '<div class="print-toolbar app-only"><a class="btn btn-secondary" href="#/qr">返回二维码</a></div><section class="card"><div class="empty">未找到天平设备卡</div></section>';
  }
  const src = type === 'person'
    ? `/api/qr/person.svg?account=${encodeURIComponent(user.id)}`
    : `/api/qr/device/${encodeURIComponent(device.id)}.svg`;
  return `<div class="print-toolbar app-only"><div><strong>${type === 'person' ? '人员身份卡' : '天平设备卡'}打印预览</strong><div class="muted small">建议按实际尺寸打印，二维码本体不小于 40 mm</div></div>
    <div class="row"><a class="btn btn-secondary" href="#/qr">返回二维码</a><button class="btn btn-primary" data-action="print-window">${icon('printer')}打印</button></div></div>
    <article class="print-paper qr-print-paper"><img src="${src}" alt="${type === 'person' ? attr(user.id) : attr(device.id)} 二维码卡片"></article>`;
}

function pageAccounts() {
  const accounts = state.data.accounts;
  return `${pageHeader('账号与角色', '一个账号只属于一种角色；检验人员账号编号用于人员身份证。',
    `<button class="btn btn-primary" data-action="account-new">${icon('plus')}新增账号</button>`)}
    <section class="card">
      <div class="alert">账号初始口令由部署配置或安全随机生成，不在审计日志中显示。新建或重置账号后会仅在当前对话框展示一次临时口令，首次登录强制改密。</div>
      <div class="table-wrap desktop-table"><table>
        <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>首次改密</th><th>验证码保护</th><th>最近登录</th><th class="col-actions">操作</th></tr></thead>
        <tbody>${accounts.map((account) => `<tr class="${account.status === '已删除' ? 'row-muted' : ''}">
          <td><b class="mono">${esc(account.id)}</b>${account.id === state.data.user.id ? '<div class="muted small">当前登录</div>' : ''}</td>
          <td>${esc(account.name)}</td><td>${tag(roleLabel(account.role), account.role === 'admin' ? 'gray' : account.role === 'verifier' ? 'violet' : 'blue')}</td>
          <td>${tag(account.status)}</td><td>${account.mustChangePassword ? tag('待修改', 'amber') : tag('已设置', 'gray')}</td>
          <td>${account.captchaRequired ? tag('已启用', 'amber') : tag('未触发', 'gray')}<div class="muted small">错误 ${Number(account.failedAttempts || 0)} 次</div></td>
          <td class="num">${esc(formatDate(account.lastLoginAt))}</td>
          <td class="col-actions"><div class="btn-group">
            <button class="btn btn-ghost btn-sm" data-action="account-edit" data-id="${attr(account.id)}">编辑</button>
            ${account.role !== 'verifier' ? `<button class="btn btn-ghost btn-sm" data-action="qr-download-person-admin" data-id="${attr(account.id)}">人员二维码</button>` : '<span class="muted small">无个人二维码</span>'}
            <button class="btn btn-ghost btn-sm" data-action="account-reset" data-id="${attr(account.id)}">重置口令</button>
            ${account.id !== state.data.user.id && account.status !== '已删除' ? `<button class="btn btn-ghost btn-sm danger-text" data-action="account-delete" data-id="${attr(account.id)}">删除</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="card-list">${accounts.map((account) => `<div class="info-card">
        <div class="row between"><div><strong>${esc(account.name)} · ${esc(account.id)}</strong><p>${esc(roleLabel(account.role))}</p></div>${tag(account.status)}</div>
        <p>${account.mustChangePassword ? '首次改密待完成' : '已设置个人口令'} · 最近登录 ${esc(formatDate(account.lastLoginAt))}</p>
        <div class="btn-group mt8"><button class="btn btn-ghost btn-sm" data-action="account-edit" data-id="${attr(account.id)}">编辑</button><button class="btn btn-ghost btn-sm" data-action="account-reset" data-id="${attr(account.id)}">重置</button></div>
      </div>`).join('')}</div>
    </section>`;
}

function filterAudit(rows) {
  const filter = state.filters.audit;
  return rows.filter((row) => {
    const date = String(row.time || '').slice(0, 10);
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;
    if (filter.account && row.account !== filter.account) return false;
    if (filter.type && row.type !== filter.type) return false;
    return true;
  });
}

function pageAudit() {
  const rows = filterAudit(state.data.audit || []);
  const types = [...new Set((state.data.audit || []).map((row) => row.type))].sort();
  const pageSize = 60;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(state.ui.auditPage, pages);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return `${pageHeader('审计日志', '只读事件流。登录、上传、分析、修改、提交、复核、导出、作废与系统配置均留痕。',
    `<button class="btn btn-secondary" data-action="export-audit">${icon('download')}导出 CSV</button>`)}
    <form class="card filterbar" data-form="audit-filter">
      <div class="field"><label>开始日期</label><input type="date" name="from" value="${attr(state.filters.audit.from)}"></div>
      <div class="field"><label>结束日期</label><input type="date" name="to" value="${attr(state.filters.audit.to)}"></div>
      <div class="field"><label>操作账号</label><select name="account">
        <option value="">全部账号</option>
        ${state.data.accounts.map((account) => `<option value="${attr(account.id)}" ${state.filters.audit.account === account.id ? 'selected' : ''}>${esc(account.id)} · ${esc(account.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>操作类型</label><select name="type">
        <option value="">全部类型</option>
        ${types.map((type) => `<option value="${attr(type)}" ${state.filters.audit.type === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}
      </select></div>
      <button class="btn btn-primary" type="submit">查询</button>
      <button class="btn btn-secondary" type="button" data-action="reset-audit-filter">重置</button>
    </form>
    <section class="card">
      <div class="card-head"><div><h2>${rows.length} 条事件</h2><p>日志只读，不提供页面编辑或删除入口</p></div><span class="muted small">第 ${page} / ${pages} 页</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>操作人</th><th>类型</th><th>对象</th><th>修改与理由</th><th>来源 / 结果</th></tr></thead>
        <tbody>${pageRows.map((row) => `<tr>
          <td class="num nowrap">${esc(formatDate(row.time))}</td>
          <td>${esc(row.name || row.account)}<div class="muted small">${esc(row.role || '')}</div></td>
          <td>${tag(row.type, 'blue')}</td>
          <td>${esc(row.objType || row.objectType || '—')}<div class="mono small">${esc(row.obj || row.objectId || '')}</div></td>
          <td class="audit-meta">${row.before || row.after ? `<span>${esc(row.before || '—')} → ${esc(row.after || '—')}</span><br>` : ''}${esc(row.reason || '')}</td>
          <td><span class="mono small">${esc(row.ip || '—')}</span><br>${tag(row.result || '成功', row.result === '失败' ? 'red' : 'green')}</td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty">没有符合筛选条件的审计事件</div></td></tr>'}</tbody>
      </table></div>
      <div class="row between mt12">
        <button class="btn btn-secondary btn-sm" data-action="audit-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="muted small">单页最多 ${pageSize} 条</span>
        <button class="btn btn-secondary btn-sm" data-action="audit-page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button>
      </div>
    </section>`;
}

function pageSystem() {
  const system = state.data.system || {};
  const storage = system.storage || state.data.storage || {};
  const settings = state.data.settings || {};
  const queue = system.queue || state.data.queue || {};
  const logs = system.logs || {};
  const backedUp = (system.backups || state.data.backups || [])[0];
  const usage = Number(storage.percent ?? storage.usagePercent ?? storage.usedPercent ?? 0);
  const estimate = storage.storageEstimate || {};
  const activeDevices = Number(estimate.activeDeviceCount || 0);
  const planningCount = Number(estimate.plannedDailyVideoCount || Math.max(1, activeDevices));
  return `${pageHeader('存储与运行状态', '服务健康、分析队列、磁盘容量、备份与配置集中查看。',
    `<button class="btn btn-secondary" data-action="system-refresh">${icon('refresh')}刷新</button>
     <button class="btn btn-secondary" data-action="health-check">${icon('server')}健康检查</button>`)}
    ${usage >= Number(settings.capacityWarnPercent || 90) ? `<div class="alert danger">视频存储已使用 ${formatNumber(usage,1)}%，达到告警阈值；容量满时按最早优先清理视频，电子记录不受影响。</div>` : ''}
    <div class="grid grid-4 mt12">
      ${[
        ['数据库', system.database?.status || '正常', `探测 ${formatNumber(system.database?.latencyMs,2)} ms`, system.database?.status !== '异常'],
        ['视频占用', `${formatNumber(storage.usedGb ?? (storage.usedBytes ? storage.usedBytes / 1024 / 1024 / 1024 : 0),1)} GB`, `配额 ${settings.videoQuotaGb || 200} GB · 已用 ${formatNumber(usage,1)}%`, usage < 100],
        ['已有视频', `${Number(storage.videoCount || 0)} 个`, `平均 ${estimate.averageVideoSizeMb ? `${formatNumber(estimate.averageVideoSizeMb,1)} MB/段` : '暂无样本'}`, true],
        ['预计还可记录', formatRetention(storage.retainDays), `${planningCount} 段/日 · ${estimate.limitingFactor || '按容量测算'}`, storage.retainDays !== null]
      ].map(([label, value, note, ok], index) => `<article class="card stat-card ${ok ? (index === 1 && usage >= 90 ? 'amber' : 'teal') : 'amber'}">
        <div class="stat-label">${esc(label)}</div><div class="stat-value" style="${String(value).length > 12 ? 'font-size:16px' : ''}">${esc(value)}</div><div class="stat-note">${esc(note)}</div>
      </article>`).join('')}
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>容量与可存储时长预估</h2><p>${esc(estimate.basis || '按每台在用天平每天 1 次校验记录估算')}；同时受视频配额与磁盘可用空间限制</p></div>
        ${tag(`${Number(storage.videoCount || 0)} 个视频`, 'blue')}</div>
      <div class="storage-estimate-grid">
        <div><span>在用天平</span><strong>${activeDevices} 台</strong><small>通常每天各新增 1 段</small></div>
        <div><span>预计每日新增</span><strong>${planningCount} 段</strong><small>${estimate.plannedDailyBytes ? formatFileSize(estimate.plannedDailyBytes / 1024 / 1024) : '需先有视频样本'}</small></div>
        <div><span>配额剩余</span><strong>${formatFileSize(Number(estimate.quotaRemainingBytes || 0) / 1024 / 1024)}</strong><small>${formatRetention(estimate.quotaRetainDays)}</small></div>
        <div><span>磁盘可用</span><strong>${storage.diskAvailableBytes === null ? '无法探测' : formatFileSize(storage.diskAvailableBytes / 1024 / 1024)}</strong><small>${formatRetention(estimate.diskRetainDays)}</small></div>
        <div class="highlight"><span>综合可存储</span><strong>${formatRetention(storage.retainDays)}</strong><small>${storage.retainMonths !== null && storage.retainMonths !== undefined ? `${storage.retainMonths} 个月 · ` : ''}${esc(estimate.limitingFactor || '')}</small></div>
        <div><span>最近备份</span><strong>${backedUp ? formatDate(backedUp.time) : '暂无'}</strong><small>数据库与配置快照</small></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>天平编号</th><th>视频数</th><th>占用容量</th></tr></thead>
        <tbody>${(storage.byDevice || []).map((item) => `<tr><td>${esc(item.id)}</td><td>${Number(item.count || 0)}</td><td>${formatNumber(item.sizeGb, 2)} GB</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">暂无视频占用数据</div></td></tr>'}</tbody>
      </table></div>
      <div class="card-head mt16"><div><h2>最近清理记录</h2><p>达到配额后按最早视频优先清理，电子记录不受影响</p></div></div>
      <div class="trace-list">${(storage.cleaned || []).map((item) => `<div class="trace-item">
        <strong>${esc(item.file)} · ${formatNumber(item.size, 1)} MB</strong>
        <p>${esc(formatDate(item.time))} · ${esc(item.reason)}</p>
      </div>`).join('') || '<div class="empty">尚无容量清理记录</div>'}</div>
    </section>
    <div class="grid grid-3 mt16">
      <section class="card span-2">
        <div class="card-head"><h2>服务状态</h2><span class="muted small">${esc(system.env?.serverTime || currentDateTimeText())}</span></div>
        ${(system.services || []).map((service) => `<div class="system-service">
          <span class="service-dot ${service.status === '运行中' ? '' : 'bad'}"></span>
          <div class="grow"><strong>${esc(service.name)}</strong><span>${esc(service.detail || '')}</span></div>
          ${tag(service.status)}
        </div>`).join('') || '<div class="empty">暂无服务状态</div>'}
        <div class="alert warn mt16">当前识别适配器：${esc(system.analyzer?.mode || system.env?.analyzerMode || 'local-display-ocr')}。默认自动搜索显示屏区域，DISPLAY_REGION 可覆盖；无法识别稳定示值时须人工补录。</div>
      </section>
      <aside class="stack">
        <section class="card">
          <div class="card-head"><h2>维护操作</h2></div>
          <button class="btn btn-primary btn-block" data-action="backup-run">立即备份数据库</button>
          <button class="btn btn-secondary btn-block mt8" data-action="cleanup-videos">执行容量清理</button>
          <a class="btn btn-secondary btn-block mt8" href="#/audit">查看审计日志</a>
          <p class="muted small mt12">清理仅处理受配额约束的原始视频，不删除记录、识别截图、PDF 和审计日志。</p>
        </section>
        <section class="card">
          <div class="card-head"><h2>运行环境</h2></div>
          <div class="kv-list">
            <div class="kv"><span>操作系统</span><strong>${esc(system.env?.os || '—')}</strong></div>
            <div class="kv"><span>Node.js</span><strong>${esc(system.env?.node || '—')}</strong></div>
            <div class="kv"><span>时区</span><strong>${esc(system.env?.timezone || 'Asia/Shanghai')}</strong></div>
            <div class="kv"><span>NTP</span><strong>${esc(system.env?.ntp || '未探测')}</strong><small class="muted">${esc(system.env?.ntpDetail || '')}</small></div>
            <div class="kv"><span>运行时长</span><strong>${formatDuration(Number(system.env?.uptimeSeconds || 0) * 1000)}</strong></div>
          </div>
        </section>
      </aside>
    </div>
    <div class="grid grid-2 mt16">
      <form class="card" data-form="system-settings">
        <div class="card-head"><div><h2>运行参数</h2><p>配置变更需保存并写入审计日志</p></div></div>
        <div class="form-grid">
          <div class="field"><label>视频配额（GB）</label><input type="number" name="videoQuotaGb" min="10" step="1" value="${attr(settings.videoQuotaGb || 200)}"></div>
          <div class="field"><label>容量告警阈值（%）</label><input type="number" name="capacityWarnPercent" min="1" max="100" value="${attr(settings.capacityWarnPercent || 90)}"></div>
          <div class="field"><label>低置信阈值</label><input type="number" name="confidenceThreshold" min="0.01" max="1" step="0.01" value="${attr(settings.confidenceThreshold || 0.9)}"></div>
          <div class="field"><label>会话空闲超时（分钟）</label><input type="number" name="sessionIdleMinutes" min="1" max="1440" value="${attr(settings.sessionIdleMinutes || 30)}"></div>
          <div class="field"><label>日志保留（天）</label><input type="number" name="logRetentionDays" min="30" max="3650" value="${attr(settings.logRetentionDays || 30)}"></div>
          <div class="field"><label>记录保留（年）</label><input type="number" name="recordRetentionYears" min="5" max="100" value="${attr(settings.recordRetentionYears || 5)}"></div>
        </div>
        <button type="submit" class="btn btn-primary mt16">保存运行参数</button>
      </form>
      <section class="card">
        <div class="card-head"><div><h2>最近错误</h2><p>仅显示最近 20 条失败或待处理事件</p></div></div>
        <div class="trace-list">
          ${(system.recentErrors || []).map((error) => `<div class="trace-item">
            <strong>${esc(error.type)} · ${esc(error.objectId || '')}</strong>
            <p>${esc(formatDate(error.time))}<br>${esc(error.message || error.reason || '')}</p>
          </div>`).join('') || '<div class="empty"><strong>没有近期错误</strong>服务运行正常。</div>'}
        </div>
      </section>
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>应用日志</h2><p>${Number(logs.fileCount || 0)} 个文件 · ${formatFileSize(Number(logs.totalBytes || 0) / 1024 / 1024)} · 按配置自动轮转与清理</p></div>
        <button class="btn btn-secondary" data-action="export-app-logs">${icon('download')}导出日志</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>级别</th><th>消息</th></tr></thead>
        <tbody>${(logs.recent || []).map((item) => `<tr>
          <td class="num nowrap">${esc(formatDate(item.time))}</td>
          <td>${tag(String(item.level || '').toUpperCase(), item.level === 'error' ? 'red' : item.level === 'warn' ? 'amber' : 'blue')}</td>
          <td class="small">${esc(item.message || '')}</td>
        </tr>`).join('') || '<tr><td colspan="3"><div class="empty">暂无应用日志</div></td></tr>'}</tbody>
      </table></div>
    </section>`;
}

function printRecordContent(record) {
  const device = deviceById(record.device) || record.deviceSnapshot || {};
  const evaluation = recordEvaluation(record) || {};
  const itemMap = new Map((evaluation.items || []).map((item) => [item.key, item]));
  const template = record.templateSnapshot || state.data.template || {};
  const configuredField = (key, fallback) => {
    const item = Array.isArray(template.fields)
      ? template.fields.find((field) => field?.key === key)
      : null;
    return {
      label: item?.label || fallback,
      show: item?.show !== false
    };
  };
  const fieldDefinitions = [
    ['id', '天平编号', device.id, true],
    ['dept', '科室', device.dept || '', false],
    ['uniqueNo', '天平唯一号', device.uniqueNo || '', false],
    ['max', 'Max(g)', device.max === undefined ? '' : `${device.max} g`, false],
    ['d', 'd(mg)', device.d === undefined ? '' : `${device.d} mg`, false],
    ['internalCalType', '内部校正方式', device.internalCal || '', false],
    ['date', '校验日期', record.date, false],
    ['cleanliness', '清洁', record.cleanliness || '', false],
    ['level', '水平调节', record.level || '', false],
    ['internalCal', '内部校正是否通过', record.internalCal || '', false],
    ['box', '砝码盒编号', record.box || '', false]
  ];
  const visibleFields = fieldDefinitions.map(([key, fallback, value, fixed]) => {
    const config = fixed
      ? { label: fallback, show: true }
      : configuredField(key, fallback);
    return { key, label: config.label, show: config.show, value };
  }).filter((field) => field.show);
  const metaRows = [];
  for (let index = 0; index < visibleFields.length; index += 3) {
    metaRows.push(visibleFields.slice(index, index + 3));
  }
  const remarkConfig = configuredField('remark', '备注');
  const timeConfig = configuredField('time', '测量时间');
  const detailConfig = configuredField('detail', '判定依据');
  const showTime = template.printTime !== false && timeConfig.show;
  const watermark = record.status === '已复核确认' ? '' : record.status === '已作废' ? '已作废' : '未复核';
  const readouts = record.readouts || [];
  return `
    ${watermark ? `<div class="print-watermark">${esc(watermark)}</div>` : ''}
    <div class="print-title">电子天平日常校验记录表</div>
    <div class="print-sub">天平编号：${esc(record.device)} · 记录编号：${esc(record.id)}</div>
    <table class="print-grid">
      ${metaRows.map((row) => `<tr>${row.map((field) => `<td class="label">${esc(field.label)}</td><td>${esc(field.value)}</td>`).join('')}${row.length < 3 ? `<td colspan="${(3 - row.length) * 2}"></td>` : ''}</tr>`).join('')}
      <tr><td class="label">模板标称点</td><td colspan="5">${(template.points || device.points || []).map((point, index) => `L${index + 1}=${esc(point)}g`).join(' · ')}</td></tr>
      ${remarkConfig.show ? `<tr><td class="label">${esc(remarkConfig.label)}</td><td colspan="5">${esc(record.remark || '无')}</td></tr>` : ''}
    </table>
    <table class="print-grid" style="margin-top:8px">
      <thead><tr><th>读数</th><th>量程</th><th>L(g)</th><th>限度区间(g)</th><th>示值 I(g)</th><th>偏差(g)</th><th>是否在限内</th>${showTime ? `<th>${esc(timeConfig.label)}</th>` : ''}</tr></thead>
      <tbody>${readouts.map((readout, index) => {
        const key = readoutKey(readout, index);
        const item = itemMap.get(key) || {};
        const dec = item.dec ?? 4;
        return `<tr><td>${esc(key)}</td><td>${esc(item.rangeLabel || (readout.range === 2 ? '低量程' : device.ranges === 2 ? '高量程' : '单量程'))}</td>
          <td>${formatNumber(item.L ?? device.points?.[readout.point], dec)}</td>
          <td>${item.lim ? `${formatNumber(item.lim.lo, dec)} ~ ${formatNumber(item.lim.hi, dec)}` : '—'}</td>
          <td>${formatNumber(item.value ?? readout.value, dec)}</td>
          <td>${item.dev == null ? '—' : formatNumber(item.dev, dec)}</td>
          <td>${item.inLimit ? '是' : '否'}</td>
          ${showTime ? `<td>${esc(formatDate(readout.time))}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table>
    <table class="print-grid" style="margin-top:8px">
      <tr><td class="label">外部校正</td><td>${esc(evaluation.conclusion || '')}</td>${detailConfig.show ? `<td class="label">${esc(detailConfig.label)}</td><td>${evaluation.pass
        ? `9 次读数均在 (1±${esc(evaluation.tol ?? 0.05)}%)×L 内，稳定、齐全、顺序正确${device.ranges === 2 ? '且完成量程切换' : ''}`
        : `不通过：${esc((evaluation.reasons || []).map((reason) => reason.label).join('；') || '存在流程或测量异常')}`
      }</td>` : '<td colspan="2"></td>'}</tr>
    </table>
    <div class="print-sign">
      <div>校验人员：${esc(accountName(record.submittedBy || record.inspector))}<br>签名时间：${esc(formatDate(record.submittedAt))}</div>
      <div>复核确认人：${esc(record.verifiedBy ? accountName(record.verifiedBy) : '')}<br>签名时间：${esc(formatDate(record.verifiedAt))}</div>
    </div>
    <div class="print-note">${esc(template.footerNote || '注：出现异常时应在备注栏准确记录，必要时及时报修。')}<br>${esc(template.footerExtra || '')}<br>导出时间：${esc(currentDateTimeText())} · 模板 ${esc(record.templateVersion || '')}</div>`;
}

function pdfPreviewPage({
  title,
  subtitle,
  pdfUrl,
  imageUrl,
  pages = 1,
  downloadMarkup,
  backHref,
  backLabel
}) {
  const separator = imageUrl.includes('?') ? '&' : '?';
  const pageImages = Array.from({ length: pages }, (_, index) => `
    <figure class="pdf-page-preview">
      <figcaption>PDF 第 ${index + 1} 页</figcaption>
      <a href="${attr(`${imageUrl}${separator}page=${index + 1}`)}" target="_blank" rel="noopener" title="打开原尺寸预览">
        <img src="${attr(`${imageUrl}${separator}page=${index + 1}`)}" alt="${attr(`${title} 第 ${index + 1} 页`)}" loading="${index === 0 ? 'eager' : 'lazy'}">
      </a>
    </figure>`).join('');
  return `<div class="print-toolbar app-only">
      <div><strong>${esc(title)}</strong><div class="muted small">${esc(subtitle)}</div></div>
      <div class="row row-wrap">
        <a class="btn btn-secondary" href="${attr(backHref)}">${esc(backLabel)}</a>
        ${downloadMarkup}
        <a class="btn btn-primary" href="${attr(pdfUrl)}" target="_blank" rel="noopener">${icon('printer')}打开 PDF 打印</a>
      </div>
    </div>
    <div class="pdf-preview-notice app-only">${icon('file')}下方图像由最终 PDF 逐页渲染；预览、下载和打印使用同一份服务端文件。</div>
    <div class="pdf-page-stack">${pageImages}</div>`;
}

function pagePrintRecord(record) {
  return pdfPreviewPage({
    title: '单日校验记录表 · 实际 PDF 预览',
    subtitle: record.id,
    pdfUrl: `/api/previews/record/${encodeURIComponent(record.id)}.pdf`,
    imageUrl: `/api/previews/record/${encodeURIComponent(record.id)}.png`,
    downloadMarkup: `<button class="btn btn-secondary" data-action="export-record" data-id="${attr(record.id)}">${icon('download')}下载 PDF</button>`,
    backHref: `#/records/${encodeURIComponent(record.id)}`,
    backLabel: '返回详情'
  });
}

async function loadWeekPrint(deviceId, weekValue) {
  const key = `${deviceId}/${weekValue}`;
  if (state.weekPrint.loading && state.weekPrint.key === key) return;
  state.weekPrint = {
    key,
    loaded: false,
    loading: true,
    items: [],
    error: ''
  };
  render();
  const range = weekRangeFromIso(weekValue);
  const query = new URLSearchParams({
    devices: deviceId,
    from: range.from,
    to: range.to,
    status: '已复核确认',
    page: '1',
    pageSize: '50'
  });
  try {
    const result = await api(`/api/records?${query.toString()}`);
    state.weekPrint = {
      key,
      loaded: true,
      loading: false,
      items: result.items || [],
      error: ''
    };
  } catch (error) {
    state.weekPrint = {
      key,
      loaded: true,
      loading: false,
      items: [],
      error: errorMessage(error)
    };
  }
  render();
}

function pagePrintWeek() {
  const query = parseRoute().query;
  const deviceId = query.get('device') || state.data.devices[0]?.id || '';
  const selectedWeek = query.get('week')
    ? weekRangeFromIso(query.get('week'))
    : {
      from: query.get('from') || naturalWeekRange().from,
      to: query.get('to') || naturalWeekRange().to,
      week: query.get('week') || naturalWeekRange().week
    };
  const { from, to } = selectedWeek;
  const device = deviceById(deviceId);
  if (state.weekPrint.loading || !state.weekPrint.loaded || state.weekPrint.key !== `${deviceId}/${selectedWeek.week}`) {
    return `<div class="print-toolbar app-only"><div><strong>每周天平校验统计记录 · A4 横向预览</strong><div class="muted small">${esc(deviceId)} · ${esc(selectedWeek.week)}</div></div>
      <div class="row"><a class="btn btn-secondary" href="#/export">返回导出</a></div></div>
      <section class="card"><div class="empty"><span class="spinner"></span>正在读取所选周的全部已复核记录…</div></section>`;
  }
  if (state.weekPrint.error) {
    return `<div class="print-toolbar app-only"><a class="btn btn-secondary" href="#/export">返回导出</a></div>
      <section class="card"><div class="empty"><strong>周统计读取失败</strong>${esc(state.weekPrint.error)}</div></section>`;
  }
  const records = (state.weekPrint?.items || []).filter((record) => (
    record.device === deviceId && record.status === '已复核确认' && record.date >= from && record.date <= to
  ));
  if (!records.length) {
    return `<div class="print-toolbar app-only"><a class="btn btn-secondary" href="#/export">返回导出</a></div>
      <section class="card"><div class="empty"><strong>所选周没有可打印记录</strong>仅已复核确认且未作废记录参与周统计。</div></section>`;
  }
  const previewPdfUrl = `/api/previews/week.pdf?device=${encodeURIComponent(deviceId)}&week=${encodeURIComponent(selectedWeek.week)}`;
  const previewImageUrl = `/api/previews/week.png?device=${encodeURIComponent(deviceId)}&week=${encodeURIComponent(selectedWeek.week)}`;
  return pdfPreviewPage({
    title: '每周天平校验统计记录 · 实际 PDF 预览',
    subtitle: `${deviceId} · ${selectedWeek.week} · ${from} ~ ${to}`,
    pdfUrl: previewPdfUrl,
    imageUrl: previewImageUrl,
    downloadMarkup: `<button class="btn btn-secondary" data-action="download-week-pdf">${icon('download')}下载 PDF</button>`,
    backHref: '#/export',
    backLabel: '返回导出'
  });
}

function pagePrintBlank() {
  return pdfPreviewPage({
    title: '电子天平日常校验空白记录表',
    subtitle: 'A4 空白表 · 预览与实际下载使用同一份 PDF',
    pdfUrl: '/api/previews/blank.pdf',
    imageUrl: '/api/previews/blank.png',
    downloadMarkup: `<a class="btn btn-secondary" href="/api/docs/blank.pdf">${icon('download')}下载 PDF</a>`,
    backHref: '#/export',
    backLabel: '返回导出'
  });
}

function pagePrintSop() {
  return pdfPreviewPage({
    title: '标准操作流程 · 实际 PDF 预览',
    subtitle: 'A4 四页文档 · 预览、打印和下载使用同一份 PDF',
    pdfUrl: '/api/previews/sop.pdf',
    imageUrl: '/api/previews/sop.png',
    pages: 4,
    downloadMarkup: `<button class="btn btn-secondary" data-action="download-sop">${icon('download')}下载 PDF</button>`,
    backHref: '#/help',
    backLabel: '返回操作流程'
  });
}

function routeAllowed(path) {
  if (path === '/upload') return isRole('inspector');
  if (path === '/verify') return isRole('verifier');
  if (path === '/devices') return isRole('inspector');
  if (['/qr', '/print/qr'].includes(path)) return isRole('inspector') || isRole('verifier');
  if (['/masterdata', '/template'].includes(path)) return can('masterdata.write') || can('template.write');
  if (['/accounts', '/audit', '/system'].includes(path)) return isRole('admin');
  return true;
}

function pageAccessDenied() {
  return shell('无权访问', '当前账号没有访问此功能的权限', `
    <section class="card">
      <div class="empty">
        <strong>权限不足</strong>
        系统已在服务端执行最小权限校验。请返回工作台，或使用具备对应角色的账号。
        <div class="mt16"><a class="btn btn-primary" href="#/dashboard">返回工作台</a></div>
      </div>
    </section>`, { pathname: parseRoute().path });
}

function render() {
  if (!state.data?.user) {
    if (state.session?.mustChangePassword) renderChangePassword();
    else renderLogin();
    return;
  }
  const { path, query } = parseRoute();
  state.route = path;
  state.ui.sidebarOpen = false;
  if (!routeAllowed(path)) {
    pageAccessDenied();
    return;
  }
  if (path === '/dashboard') {
    shell('工作台', '今日校验与待办概览', pageDashboard(), { pathname: path });
    return;
  }
  if (path === '/upload') {
    shell('上传校验视频', '原始视频与拍摄时间确认', pageUpload(), { pathname: path });
    return;
  }
  if (path === '/tasks') {
    shell(isRole('admin') ? '分析队列' : '我的分析任务', 'FIFO 串行分析与异常任务处理', pageTasks(), { pathname: path });
    return;
  }
  if (path === '/records') {
    const drafts = query.get('draft') === '1';
    if (!state.recordsView.loaded && !state.recordsView.loading) {
      window.setTimeout(() => loadRecordsPage(state.recordsView.page || 1), 0);
    }
    shell(drafts ? '待核对记录' : '校验记录', drafts ? '核对并电子确认' : '跨人员、跨天平查询', pageRecords(), { pathname: path });
    return;
  }
  const recordMatch = /^\/records\/([^/]+)$/.exec(path);
  if (recordMatch) {
    const id = decodeURIComponent(recordMatch[1]);
    const record = recordById(id);
    if (!record) {
      shell('记录详情', '正在读取记录与证据', `
        <section class="card"><div class="empty">
          <span class="spinner"></span>
          正在从服务端载入记录 ${esc(id)}…
        </div></section>`, { pathname: '/records' });
      loadRecordDetail(id)
        .then(() => render())
        .catch((error) => {
          shell('记录详情', '记录数据加载失败', `
            <section class="card"><div class="empty">
              <strong>无法读取记录 ${esc(id)}</strong>
              ${esc(errorMessage(error))}
              <div class="mt16"><a class="btn btn-primary" href="#/records">返回记录列表</a></div>
            </div></section>`, { pathname: '/records' });
        });
      return;
    }
    shell('记录详情', id, pageRecordDetail(record), { pathname: '/records' });
    return;
  }
  const historyMatch = /^\/history\/([^/]+)$/.exec(path);
  if (historyMatch) {
    const deviceId = decodeURIComponent(historyMatch[1]);
    if (state.historyView.device !== deviceId
      || (!state.historyView.loaded && !state.historyView.loading)) {
      window.setTimeout(() => loadHistoryRecords(deviceId, 1), 0);
    }
    shell('天平历史汇总', `${deviceId} · 示值明细`, pageHistory(deviceId), { pathname: '/records' });
    return;
  }
  if (path === '/verify') {
    if (!state.verifyView.loaded && !state.verifyView.loading) {
      window.setTimeout(() => loadVerifyRecords(1), 0);
    }
    shell('待复核', '检查证据并完成电子签名', pageVerify(), { pathname: path });
    return;
  }
  if (path === '/devices') {
    shell('天平档案', '设备量程、参考点和历史记录只读查询', pageDeviceDirectory(), { pathname: path });
    return;
  }
  if (path === '/masterdata') {
    shell('主数据', '天平档案与砝码盒字典', pageMasterData(), { pathname: path });
    return;
  }
  if (path === '/template') {
    shell('记录模板', '固定表结构与版本化配置', pageTemplate(), { pathname: path });
    return;
  }
  if (path === '/export') {
    shell('导出与打印', 'PDF、CSV 与 A4 留档', pageExport(), { pathname: path });
    return;
  }
  if (path === '/qr') {
    shell(
      isRole('inspector') ? '二维码中心' : '设备二维码',
      isRole('inspector') ? '人员身份卡与天平设备卡' : '天平设备卡查询与打印',
      pageQr(),
      { pathname: path }
    );
    return;
  }
  if (path === '/help') {
    shell('标准操作流程', '从登录到复核归档的完整使用方法', pageHelp(), { pathname: path });
    return;
  }
  if (path === '/accounts') {
    shell('账号与角色', '人员权限与人员卡编号', pageAccounts(), { pathname: path });
    return;
  }
  if (path === '/audit') {
    shell('审计日志', '不可编辑的系统事件流', pageAudit(), { pathname: path });
    return;
  }
  if (path === '/system') {
    shell('存储与运行状态', '队列、数据库、备份和系统配置', pageSystem(), { pathname: path });
    return;
  }
  const printMatch = /^\/print\/record\/([^/]+)$/.exec(path);
  if (printMatch) {
    const recordId = decodeURIComponent(printMatch[1]);
    const record = recordById(recordId);
    if (!record) {
      root.innerHTML = '<main class="main" style="margin-left:0"><div class="content"><section class="card"><div class="empty"><span class="spinner"></span>正在读取记录并生成 PDF…</div></section></div></main>';
      loadRecordDetail(recordId)
        .then(() => render())
        .catch((error) => {
          root.innerHTML = `<main class="main" style="margin-left:0"><div class="content"><section class="card"><div class="empty"><strong>无法生成 PDF</strong>${esc(errorMessage(error))}<div class="mt16"><a class="btn btn-secondary" href="#/records">返回记录列表</a></div></div></section></div></main>`;
        });
      return;
    }
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintRecord(record)}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/week') {
    const query = parseRoute().query;
    const selectedWeek = query.get('week') || naturalWeekRange().week;
    const selectedDevice = query.get('device') || state.data.devices[0]?.id || '';
    const printKey = `${selectedDevice}/${selectedWeek}`;
    if (state.weekPrint.key !== printKey && !state.weekPrint.loading) {
      window.setTimeout(() => loadWeekPrint(selectedDevice, selectedWeek), 0);
    }
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintWeek()}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/blank') {
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintBlank()}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/sop') {
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintSop()}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/qr') {
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintQr()}</div></main>`;
    wireDynamic();
    return;
  }
  shell('页面不存在', '请从导航重新选择功能', `
    <section class="card"><div class="empty"><strong>找不到 ${esc(path)}</strong>
      <div class="mt16"><a class="btn btn-primary" href="#/dashboard">返回工作台</a></div>
    </div></section>`, { pathname: path });
}

function closeModal() {
  state.modal = null;
  modalRoot.innerHTML = '';
}

function openModal({
  title,
  subtitle = '',
  body = '',
  wide = false,
  primary = '确定',
  danger = false,
  cancel = '取消',
  onConfirm = null
}) {
  state.modal = { onConfirm };
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-background>
      <section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          <button type="button" class="modal-close" data-modal-close aria-label="关闭">×</button>
        </div>
        <form id="modal-form">
          <div class="modal-body">${body}</div>
          <div class="modal-foot">
            ${cancel ? `<button type="button" class="btn btn-secondary" data-modal-close>${esc(cancel)}</button>` : ''}
            ${onConfirm ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(primary)}</button>` : `<button type="button" class="btn btn-primary" data-modal-close>${esc(primary)}</button>`}
          </div>
        </form>
      </section>
    </div>`;
  const firstInput = modalRoot.querySelector('input:not([type=hidden]), textarea, select');
  firstInput?.focus();
}

function confirmModal({ title, message, primary = '确认', danger = false, onConfirm }) {
  openModal({
    title,
    body: `<div class="alert ${danger ? 'danger' : 'warn'}">${esc(message)}</div>`,
    primary,
    danger,
    onConfirm
  });
}

async function withBusy(button, task) {
  if (button) {
    button.disabled = true;
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span>处理中…';
  }
  try {
    return await task();
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    }
  }
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function selectedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

async function refreshAndRender() {
  await loadState({ renderAfter: false });
  render();
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'download.bin';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileNameFromResponse(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Fall through to the ASCII file name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] || fallback;
}

async function downloadFromApi(path, body, fallbackName, method = 'POST') {
  const response = await fetchResponse(path, {
    method,
    body: method === 'GET' ? undefined : (body || {})
  });
  const blob = await response.blob();
  triggerDownload(blob, fileNameFromResponse(response, fallbackName));
  return blob.size;
}

async function downloadIdentityCard(path, fallbackName, format = 'svg') {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetchResponse(`${path}${separator}download=1`, { method: 'GET' });
  const svgBlob = await response.blob();
  if (format === 'svg') {
    triggerDownload(svgBlob, fallbackName);
    return;
  }
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new ClientError('二维码图像转换失败'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1320;
    canvas.height = 780;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ClientError('PNG 生成失败')), 'image/png');
    });
    triggerDownload(pngBlob, fallbackName);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function parseStoredFilename(contentDisposition) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition || '');
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

async function downloadAuditCsv() {
  const query = new URLSearchParams();
  const filter = state.filters.audit;
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
  query.set('format', 'csv');
  const response = await fetchResponse(`/api/audit?${query.toString()}`);
  const blob = await response.blob();
  triggerDownload(blob, fileNameFromResponse(response, '审计日志.csv'));
}

function recordDetailById(id) {
  return recordById(id);
}

async function loadRecordDetail(id) {
  const result = await api(`/api/records/${encodeURIComponent(id)}`);
  if (!result?.record) throw new ClientError('服务端未返回记录详情');
  const record = {
    ...result.record,
    evaluation: result.evaluation || recordEvaluation(result.record)
  };
  const existingIndex = state.data.records.findIndex((candidate) => candidate.id === id);
  if (existingIndex >= 0) state.data.records.splice(existingIndex, 1, record);
  else state.data.records.unshift(record);
  if (result.device) {
    const deviceIndex = state.data.devices.findIndex((candidate) => candidate.id === result.device.id);
    if (deviceIndex >= 0) state.data.devices.splice(deviceIndex, 1, result.device);
    else state.data.devices.push(result.device);
  }
  if (result.template) state.data.template = result.template;
  return record;
}

function deviceForm(device = null) {
  const editing = Boolean(device);
  const dictionaries = state.data.dictionaries || [];
  const departments = dictionaries.filter((item) => item.category === 'department' && item.status === '启用');
  const calibrationOptions = dictionaries.filter((item) => item.category === 'internal_cal' && item.status === '启用');
  const value = device || {
    id: '',
    uniqueNo: '',
    dept: '化学室',
    ranges: 1,
    range1: { max: 220, d: 0.1 },
    range2: null,
    internalCal: '手动触发',
    points: [200, 50, 10],
    tol: 0.05,
    defaultBox: '',
    qrContent: '天平编号',
    status: '在用',
    remark: ''
  };
  return `
    <div class="form-grid">
      <div class="field"><label class="${editing ? '' : 'required'}">天平编号</label><input name="id" value="${attr(value.id)}" ${editing ? 'disabled' : ''} placeholder="留空自动生成，如 F001"></div>
      <div class="field"><label class="required">天平唯一号</label><input name="uniqueNo" value="${attr(value.uniqueNo)}" maxlength="20" required></div>
      <div class="field"><label class="required">科室</label><input name="dept" list="department-list" value="${attr(value.dept)}" required>
        <datalist id="department-list">${departments.map((item) => `<option value="${attr(item.value)}">${esc(item.label)}</option>`).join('')}</datalist></div>
      <div class="field"><label class="required">量程数量</label><select name="ranges" id="device-ranges">
        <option value="1" ${value.ranges !== 2 ? 'selected' : ''}>单量程</option>
        <option value="2" ${value.ranges === 2 ? 'selected' : ''}>双量程</option>
      </select></div>
      <div class="field"><label class="required">第一量程 Max(g)</label><input name="range1Max" type="number" step="0.0001" min="0.0001" value="${attr(value.range1?.max || 220)}" required></div>
      <div class="field"><label class="required">第一量程 d(mg)</label><input name="range1D" type="number" step="0.0001" min="0.0001" value="${attr(value.range1?.d || 0.1)}" required></div>
      <div class="field" id="range2-max-field"><label>第二量程 Max(g)</label><input name="range2Max" type="number" step="0.0001" value="${attr(value.range2?.max ?? '')}"></div>
      <div class="field" id="range2-d-field"><label>第二量程 d(mg)</label><input name="range2D" type="number" step="0.0001" value="${attr(value.range2?.d ?? '')}"></div>
      <div class="field"><label class="required">内部校正方式</label><select name="internalCal">
        ${(calibrationOptions.length ? calibrationOptions : ['自动触发', '手动触发', 'NA'].map((option) => ({ value: option, label: option }))).map((item) => `<option value="${attr(item.value)}" ${value.internalCal === item.value ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
        ${!calibrationOptions.some((item) => item.value === value.internalCal) && value.internalCal ? `<option value="${attr(value.internalCal)}" selected>${esc(value.internalCal)}（历史值）</option>` : ''}
      </select></div>
      <div class="field"><label class="required">容差系数（%）</label><input name="tol" type="number" step="0.001" min="0.001" max="10" value="${attr(value.tol || 0.05)}" required></div>
      <div class="field"><label class="required">L1(g)</label><input name="point1" type="number" step="0.0001" value="${attr(value.points?.[0] ?? 200)}" required></div>
      <div class="field"><label class="required">L2(g)</label><input name="point2" type="number" step="0.0001" value="${attr(value.points?.[1] ?? 50)}" required></div>
      <div class="field"><label class="required">L3(g)</label><input name="point3" type="number" step="0.0001" value="${attr(value.points?.[2] ?? 10)}" required></div>
      <div class="field"><label>默认砝码盒</label><input name="defaultBox" value="${attr(value.defaultBox || '')}" maxlength="10" placeholder="选择便利，不构成绑定"></div>
      <div class="field"><label>设备二维码内容</label><select name="qrContent">
        <option ${value.qrContent === '天平编号' ? 'selected' : ''}>天平编号</option>
        <option ${value.qrContent === '天平唯一号' ? 'selected' : ''}>天平唯一号</option>
      </select></div>
      <div class="field"><label>状态</label><select name="status"><option ${value.status !== '停用' ? 'selected' : ''}>在用</option><option ${value.status === '停用' ? 'selected' : ''}>停用</option></select></div>
      <div class="field full"><label>备注</label><textarea name="remark">${esc(value.remark || '')}</textarea></div>
    </div>
    <div class="row mt12"><button type="button" class="btn btn-secondary btn-sm" data-action="recommend-points">按典型量程推荐标称点</button>
      <span class="muted small">限度按 (1±容差%)×L 自动计算，小数位随对应量程 d 对齐。</span></div>`;
}

function buildDevicePayload(form) {
  const data = formObject(form);
  const ranges = Number(data.ranges) === 2 ? 2 : 1;
  if (!data.uniqueNo?.trim() || !data.dept?.trim()) throw new ClientError('天平唯一号与科室不能为空');
  const points = ['point1', 'point2', 'point3'].map((name) => Number(data[name]));
  if (points.some((value) => !Number.isFinite(value) || value <= 0)) throw new ClientError('三个砝码标称点必须为正数');
  const range1 = { max: Number(data.range1Max), d: Number(data.range1D) };
  if (!(range1.max > 0) || !(range1.d > 0)) throw new ClientError('第一量程与精度必须为正数');
  const range2 = ranges === 2 ? { max: Number(data.range2Max), d: Number(data.range2D) } : null;
  if (ranges === 2 && (!(range2?.max > 0) || !(range2?.d > 0))) throw new ClientError('双量程必须填写第二量程和精度');
  return {
    id: data.id?.trim() || undefined,
    uniqueNo: data.uniqueNo.trim(),
    dept: data.dept.trim(),
    max: range1.max,
    d: range1.d,
    ranges,
    range1,
    range2,
    internalCal: data.internalCal,
    points,
    pointRange: ranges === 2 ? [1, 2, 2] : [1, 1, 1],
    tol: Number(data.tol),
    defaultBox: data.defaultBox?.trim() || '',
    qrContent: data.qrContent,
    qrValue: data.qrContent === '天平唯一号' ? data.uniqueNo.trim() : data.id?.trim(),
    status: data.status,
    remark: data.remark?.trim() || ''
  };
}

function showDeviceModal(device = null) {
  openModal({
    title: device ? `编辑天平 ${device.id}` : '新建天平档案',
    subtitle: '限度=(1±容差%)×L；双量程第一标称点属于高量程，余下两点属于低量程',
    body: deviceForm(device),
    wide: true,
    primary: '保存天平档案',
    onConfirm: async (form) => {
      const payload = buildDevicePayload(form);
      if (device) {
        await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: payload });
      } else {
        await api('/api/devices', { method: 'POST', body: payload });
      }
      closeModal();
      toast('天平档案已保存并写入审计日志', 'success');
      await refreshAndRender();
    }
  });
}

function showBoxModal(box = null) {
  const editing = Boolean(box);
  openModal({
    title: editing ? `编辑砝码盒 ${box.id}` : '新增砝码盒',
    subtitle: '砝码盒编号仅含字母和数字，最多 10 位；不建立设备绑定',
    body: `<div class="form-grid">
      <div class="field"><label class="required">砝码盒编号</label><input name="id" maxlength="10" value="${attr(box?.id || '')}" ${editing ? 'disabled' : ''} required></div>
      <div class="field"><label>状态</label><select name="status"><option ${box?.status !== '停用' ? 'selected' : ''}>启用</option><option ${box?.status === '停用' ? 'selected' : ''}>停用</option></select></div>
      <div class="field full"><label>备注</label><textarea name="remark">${esc(box?.remark || '')}</textarea></div>
    </div>`,
    primary: '保存字典项',
    onConfirm: async (form) => {
      const data = formObject(form);
      const id = editing ? box.id : data.id.trim().toUpperCase();
      if (!/^[A-Za-z0-9]{1,10}$/.test(id)) throw new ClientError('砝码盒编号只能包含字母与数字，最多 10 位');
      const body = { id, status: data.status, remark: data.remark?.trim() || '' };
      await api(editing ? `/api/weight-boxes/${encodeURIComponent(id)}` : '/api/weight-boxes', {
        method: editing ? 'PATCH' : 'POST',
        body
      });
      closeModal();
      toast('砝码盒字典项已保存并写入审计日志', 'success');
      await refreshAndRender();
    }
  });
}

function showDictionaryModal(item = null) {
  const editing = Boolean(item);
  openModal({
    title: editing ? `编辑字典项 ${item.label || item.value}` : '新增基础数据字典项',
    subtitle: '编号规则使用 {seq:03} 或 %03d 表示流水号；启用新规则后旧规则自动停用',
    body: `<div class="form-grid">
      <div class="field"><label class="required">类别</label><select name="category">
        <option value="department" ${item?.category === 'department' ? 'selected' : ''}>科室</option>
        <option value="internal_cal" ${item?.category === 'internal_cal' ? 'selected' : ''}>内部校正方式</option>
        <option value="device_numbering_rule" ${item?.category === 'device_numbering_rule' ? 'selected' : ''}>天平编号规则</option>
      </select></div>
      <div class="field"><label class="required">字典值</label><input name="value" maxlength="100" value="${attr(item?.value || '')}" required></div>
      <div class="field"><label class="required">显示名称</label><input name="label" maxlength="100" value="${attr(item?.label || '')}" required></div>
      <div class="field"><label>排序</label><input name="sortOrder" type="number" min="-10000" max="10000" value="${attr(item?.sortOrder ?? 100)}"></div>
      <div class="field"><label>状态</label><select name="status">
        <option ${item?.status !== '停用' ? 'selected' : ''}>启用</option>
        <option ${item?.status === '停用' ? 'selected' : ''}>停用</option>
      </select></div>
      <div class="field full"><label>备注</label><textarea name="remark">${esc(item?.remark || '')}</textarea></div>
    </div>`,
    primary: '保存字典项',
    onConfirm: async (form) => {
      const data = formObject(form);
      if (!data.value?.trim() || !data.label?.trim()) {
        throw new ClientError('字典值与显示名称不能为空');
      }
      await api(
        editing ? `/api/dictionaries/${encodeURIComponent(item.id)}` : '/api/dictionaries',
        {
          method: editing ? 'PATCH' : 'POST',
          body: {
            category: data.category,
            value: data.value.trim(),
            label: data.label.trim(),
            sortOrder: Number(data.sortOrder || 100),
            status: data.status,
            remark: data.remark?.trim() || ''
          }
        }
      );
      closeModal();
      toast('基础数据字典已保存并写入审计日志', 'success');
      await refreshAndRender();
    }
  });
}

function showAccountModal(account = null) {
  const editing = Boolean(account);
  openModal({
    title: editing ? `编辑账号 ${account.id}` : '新增账号',
    subtitle: '一个账号只能承担一种角色；检验人员账号编号用于人员二维码',
    body: `<div class="form-grid">
      <div class="field"><label class="${editing ? '' : 'required'}">账号编号</label><input name="id" value="${attr(account?.id || '')}" maxlength="20" ${editing ? 'disabled' : ''}></div>
      <div class="field"><label class="required">姓名</label><input name="name" value="${attr(account?.name || '')}" maxlength="100" required></div>
      <div class="field"><label>角色</label><select name="role">
        <option value="inspector" ${account?.role === 'inspector' ? 'selected' : ''}>检验人员</option>
        <option value="verifier" ${account?.role === 'verifier' ? 'selected' : ''}>复核确认人员</option>
        <option value="admin" ${account?.role === 'admin' ? 'selected' : ''}>管理员</option>
      </select></div>
      <div class="field"><label>状态</label><select name="status"><option ${account?.status !== '停用' ? 'selected' : ''}>启用</option><option ${account?.status === '停用' ? 'selected' : ''}>停用</option></select></div>
      ${editing ? '' : '<div class="field full"><label>初始口令（可选）</label><input name="initialPassword" type="password" minlength="8" placeholder="留空则由系统生成一次性临时口令"></div>'}
    </div>`,
    primary: '保存账号',
    onConfirm: async (form) => {
      const data = formObject(form);
      const id = editing ? account.id : data.id?.trim();
      if (!id || !data.name?.trim()) throw new ClientError('账号编号与姓名不能为空');
      const body = {
        id,
        name: data.name.trim(),
        role: data.role,
        status: data.status
      };
      if (!editing && data.initialPassword) body.initialPassword = data.initialPassword;
      const saved = await api(editing ? `/api/accounts/${encodeURIComponent(id)}` : '/api/accounts', {
        method: editing ? 'PATCH' : 'POST',
        body
      });
      if (saved?.temporaryPassword) {
        openModal({
          title: `账号 ${saved.id} 已创建`,
          subtitle: '临时口令只在此处展示一次，请安全交付给账号持有人',
          body: `<div class="alert warn">一次性临时口令：<b class="mono">${esc(saved.temporaryPassword)}</b></div>
            <p class="muted">账号持有人首次登录后必须立即修改口令。关闭本对话框后，系统不再展示该明文。</p>`,
          primary: '我已妥善记录',
          onConfirm: async () => {
            closeModal();
            await refreshAndRender();
          }
        });
      } else {
        closeModal();
        toast('账号已保存，操作已写入审计日志', 'success');
      }
      await refreshAndRender();
    }
  });
}

function showEditReadoutModal(record, key) {
  const evaluation = recordEvaluation(record);
  const item = evaluation?.items?.find((candidate) => candidate.key === key);
  const readout = record.readouts?.find((candidate, index) => readoutKey(candidate, index) === key);
  if (!item || !readout) throw new ClientError('未找到该读数');
  openModal({
    title: `修正测量示值 ${key}`,
    subtitle: `${record.device} · 标称值 ${item.L}g · 限度 ${formatNumber(item.lim.lo, item.dec)} ~ ${formatNumber(item.lim.hi, item.dec)}g`,
    body: `
      <div class="alert warn">所有修正将记录修改前后值、时间、操作人和理由，并立即重新计算判定。</div>
      <div class="form-grid mt16">
        <div class="field"><label>原识别值</label><input value="${attr(item.missing ? '（缺次）' : formatNumber(item.value, item.dec))}" disabled></div>
        <div class="field"><label class="required">修正后示值（g）</label><input name="value" type="number" step="any" value="${attr(item.missing ? '' : item.value)}" required></div>
        <div class="field full"><label>测量时间</label><input name="time" type="datetime-local" value="${attr(String(readout.time || record.startTime || '').replace(' ', 'T').slice(0, 16))}" required></div>
        <div class="field full"><label>修正理由</label><textarea name="reason" placeholder="例如：按识别截图核对，末位疑似误读"></textarea></div>
      </div>`,
    primary: '保存修正并复算',
    onConfirm: async (form) => {
      const data = formObject(form);
      if (data.value === '') throw new ClientError('请填写修正后的示值');
      await api(`/api/records/${encodeURIComponent(record.id)}/readouts/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: {
          value: Number(data.value),
          time: data.time.replace('T', ' '),
          reason: data.reason?.trim() || ''
        }
      });
      closeModal();
      toast(`${key} 已修正并重新计算判定`, 'success');
      await refreshAndRender();
    }
  });
}

function showSubmitModal(record) {
  const evaluation = recordEvaluation(record);
  const low = record.readouts.filter(
    (readout) => Number(readout.conf) < Number(state.data.settings.confidenceThreshold || 0.9)
  ).length;
  openModal({
    title: `一键提交 ${record.id}`,
    subtitle: '提交即视为检验人员电子确认',
    body: `<div class="alert ${evaluation?.pass ? 'success' : 'warn'}">
        当前判定：<b>${esc(evaluation?.conclusion || '—')}</b>。${evaluation?.pass ? '九次读数与流程检查满足要求。' : '不通过记录仍须提交并作为异常记录归档。'}
      </div>
      <div class="kv-list mt12">
        <div class="kv"><span>记录编号</span><strong class="mono">${esc(record.id)}</strong></div>
        <div class="kv"><span>低置信读数</span><strong>${low} 个（服务端将再次确认是否全部核对）</strong></div>
        <div class="kv"><span>提交后限制</span><strong>仅备注可修改；复核确认后全部字段锁定。</strong></div>
      </div>`,
    primary: '确认提交',
    onConfirm: async () => {
      await api(`/api/records/${encodeURIComponent(record.id)}/submit`, { method: 'POST', body: {} });
      closeModal();
      toast('记录已提交并进入待复核队列', 'success');
      await refreshAndRender();
    }
  });
}

function showManualTaskModal(task) {
  const activeDevices = state.data.devices.filter((device) => device.status === '在用');
  openModal({
    title: `人工补录 ${task.id}`,
    subtitle: `${task.file} · ${task.reason || '自动分析未生成正式记录'}`,
    wide: true,
    body: `
      <div class="alert warn">人工补录仅用于已核实原始视频的失败或待处理任务。服务端会记录补录行为，读数仍由统一规则判定。</div>
      <div class="field full mt12"><label class="required">人工补录理由</label><textarea name="manualReason" required placeholder="说明卡面、读数或显示区域无法自动识别的核实过程"></textarea></div>
      <div class="form-grid mt16">
        <div class="field"><label class="required">天平档案</label><select name="deviceId" required>
          ${activeDevices.map((device) => `<option value="${attr(device.id)}">${esc(device.id)} · ${esc(device.uniqueNo)} · ${esc(device.points.join(' / '))}g</option>`).join('')}
        </select></div>
        <div class="field"><label>视频时长（秒）</label><input name="durationSeconds" type="number" min="0" step="1" value="${attr(task.durationSeconds || '')}"></div>
        <div class="field"><label>清洁</label><select name="cleanliness"><option>是</option><option>否</option><option>NA</option></select></div>
        <div class="field"><label>水平调节</label><select name="level"><option>是</option><option>否</option><option>NA</option></select></div>
        <div class="field"><label>内部校正通过</label><select name="internalCal"><option>是</option><option>否</option><option>NA</option></select></div>
        <div class="field"><label>量程切换</label><label class="row" style="min-height:38px"><input name="rangeSwitch" type="checkbox" checked> 已核实双量程切换过程</label></div>
      </div>
      <h3 class="section-title mt24">九次测量示值</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>读数</th><th>示值 I(g)</th><th>测量时间</th><th>稳定</th></tr></thead>
        <tbody>${Array.from({ length: 9 }, (_, index) => {
          const point = Math.floor(index / 3);
          const idx = (index % 3) + 1;
          const offset = 30 + index * 35;
          return `<tr><td><b class="mono">I${point + 1}-${idx}</b></td>
            <td><input name="value_${point}_${idx}" type="number" step="any"></td>
            <td><input name="time_${point}_${idx}" type="datetime-local" value="${attr(dateTimeAtOffset(task.startTime, offset))}"></td>
            <td><input name="stable_${point}_${idx}" type="checkbox" checked></td></tr>`;
        }).join('')}</tbody>
      </table></div>`,
    primary: '生成人工补录记录',
    onConfirm: async (form) => {
      const data = formObject(form);
      const device = deviceById(data.deviceId);
      if (!device) throw new ClientError('请选择在用天平');
      const readouts = [];
      for (let point = 0; point < 3; point += 1) {
        for (let idx = 1; idx <= 3; idx += 1) {
          const value = data[`value_${point}_${idx}`];
          const timeValue = String(data[`time_${point}_${idx}`] || '').replace('T', ' ');
          const startMs = new Date(
            String(task.startTime).replace(' ', 'T').slice(0, 16) + ':00+08:00'
          ).getTime();
          const readoutMs = new Date(`${String(data[`time_${point}_${idx}`]).slice(0, 16)}:00+08:00`).getTime();
          const off = Number.isFinite(startMs) && Number.isFinite(readoutMs)
            ? Math.max(0, Math.round((readoutMs - startMs) / 1000))
            : 30 + (point * 3 + idx - 1) * 35;
          readouts.push({
            point,
            idx,
            value: value === '' ? null : Number(value),
            unit: 'g',
            off,
            conf: value === '' ? 0 : 1,
            stable: form.querySelector(`[name="stable_${point}_${idx}"]`)?.checked !== false,
            time: timeValue,
            range: device.ranges === 2 && point > 0 ? 2 : 1
          });
        }
      }
      await api(`/api/tasks/${encodeURIComponent(task.id)}/manual-complete`, {
        method: 'POST',
        body: {
          deviceId: device.id,
          manualReason: data.manualReason?.trim() || '',
          durationSeconds: data.durationSeconds ? Number(data.durationSeconds) : null,
          rangeSwitch: form.querySelector('[name="rangeSwitch"]')?.checked !== false,
          readouts,
          cleanliness: data.cleanliness,
          level: data.level,
          internalCal: data.internalCal
        }
      });
      closeModal();
      toast('人工补录记录已生成，请核对后提交', 'success');
      await refreshAndRender();
    }
  });
}

function validateVideoFile(file) {
  if (!file) throw new ClientError('请先选择视频文件');
  const extension = String(file.name).split('.').pop().toLowerCase();
  if (!['mp4', 'mov'].includes(extension)) {
    throw new ClientError('仅支持 MP4 或 MOV 视频文件');
  }
  if (file.size > 500 * 1024 * 1024) {
    throw new ClientError('单个视频文件不能超过 500MB');
  }
  if (file.size <= 0) throw new ClientError('视频文件为空');
  return file;
}

function openUploadDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持上传会话恢复'));
      return;
    }
    const request = indexedDB.open('tianping-upload-resume', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('sessions')) {
        request.result.createObjectStore('sessions', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开上传恢复存储'));
  });
}

async function saveUploadSession() {
  const up = state.upload;
  if (!up.file || !up.uploadId || !state.data?.user?.id) return;
  const db = await openUploadDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put({
      key: 'active',
      userId: state.data.user.id,
      uploadId: up.uploadId,
      fileName: up.file.name,
      fileType: up.file.type,
      fileSize: up.file.size,
      fileBlob: up.file,
      startedAt: up.startedAt,
      expectedDeviceId: up.expectedDeviceId,
      timeConfirmed: up.confirmed,
      offset: up.offset,
      savedAt: Date.now()
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('保存上传会话失败'));
  });
  db.close();
}

async function clearUploadSession() {
  try {
    const db = await openUploadDatabase();
    await new Promise((resolve) => {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').delete('active');
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
    db.close();
  } catch {
    // Browser storage may be disabled; the active upload still works in memory.
  }
}

async function restoreUploadSession() {
  if (!state.data?.user?.id || state.upload.busy || state.upload.uploadId) return false;
  try {
    const db = await openUploadDatabase();
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction('sessions', 'readonly')
        .objectStore('sessions').get('active');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!saved || saved.userId !== state.data.user.id || !saved.uploadId) return false;
    const current = await api(`/api/uploads/${encodeURIComponent(saved.uploadId)}`, {
      allowUnauthorized: true
    });
    if (!['上传中', '失败'].includes(current.status)) {
      await clearUploadSession();
      return false;
    }
    const file = new File([saved.fileBlob], saved.fileName || current.fileName, {
      type: saved.fileType || 'video/mp4',
      lastModified: saved.savedAt || Date.now()
    });
    state.upload.file = file;
    state.upload.uploadId = saved.uploadId;
    state.upload.startedAt = current.startedAt || saved.startedAt;
    state.upload.expectedDeviceId = saved.expectedDeviceId || state.upload.expectedDeviceId;
    state.upload.offset = Number(current.receivedBytes || 0);
    state.upload.progress = file.size ? state.upload.offset / file.size * 100 : 0;
    state.upload.confirmed = Boolean(current.timeConfirmed || saved.timeConfirmed);
    state.upload.status = current.receivedBytes >= current.sizeBytes && !state.upload.confirmed
      ? '等待确认拍摄时间'
      : current.status === '失败'
        ? '已恢复失败的上传会话，可取消后重新开始'
        : '已恢复未完成上传，可从服务器断点继续';
    state.upload.message = current.receivedBytes >= current.sizeBytes && !state.upload.confirmed
      ? '视频已完整接收，但缺少拍摄时间元数据；确认时间后可继续创建任务。'
      : '浏览器刷新后已恢复所选视频和服务器上传偏移。';
    return true;
  } catch {
    await clearUploadSession();
    return false;
  }
}

function chooseVideoFile(file) {
  try {
    state.upload.file = validateVideoFile(file);
    state.upload.uploadId = null;
    state.upload.offset = 0;
    state.upload.progress = 0;
    state.upload.status = '';
    state.upload.message = '';
    state.upload.completedTaskId = '';
    state.upload.sha256 = '';
    state.upload.duplicateWarning = '';
    state.upload.metadataStartTime = '';
    clearUploadSession();
    render();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function startUpload() {
  const up = state.upload;
  if (up.busy || !up.file) return;
  const startedAt = String(up.startedAt || '').replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startedAt)) {
    toast('请填写完整的拍摄开始时间', 'error');
    return;
  }
  if (!up.expectedDeviceId) {
    toast('请选择预计天平', 'warn');
    return;
  }
  up.busy = true;
  up.abortController = new AbortController();
  up.status = '正在初始化上传';
  up.message = '';
  up.completedTaskId = '';
  render();
  try {
    let initialized;
    if (up.uploadId) {
      initialized = await api(`/api/uploads/${encodeURIComponent(up.uploadId)}`, {
        signal: up.abortController.signal
      });
      if (!['上传中', '失败'].includes(initialized.status)) {
        await clearUploadSession();
        up.uploadId = null;
        initialized = null;
      }
    }
    if (!initialized) {
      initialized = await api('/api/uploads/init', {
        method: 'POST',
        body: {
          fileName: up.file.name,
          sizeBytes: up.file.size,
          startedAt,
          timeConfirmed: up.confirmed,
          expectedDeviceId: up.expectedDeviceId
        },
        signal: up.abortController.signal
      });
      up.uploadId = initialized.uploadId;
      up.duplicateWarning = initialized.duplicateWarning || '';
    }
    up.offset = Number(initialized.receivedBytes || up.offset || 0);
    up.progress = up.file.size ? up.offset / up.file.size * 100 : 0;
    up.status = up.offset ? '从服务器断点继续上传' : '正在上传';
    await saveUploadSession().catch(() => {});
    render();
    await uploadRemainingChunks();
  } catch (error) {
    if (error.name === 'AbortError') {
      up.status = '上传已取消';
      up.message = '已中止本次上传。若服务端已接收部分分片，可使用同一会话继续。';
    } else if (error.code === 'TIME_CONFIRMATION_REQUIRED') {
      up.status = '等待确认拍摄时间';
      up.message = '视频没有拍摄时间元数据；请勾选确认拍摄开始时间，然后再次点击上传继续，无需重新发送文件。';
    } else {
      up.status = '上传失败';
      up.message = errorMessage(error);
      toast(errorMessage(error), 'error');
    }
    up.busy = false;
    up.abortController = null;
    render();
  }
}

async function uploadRemainingChunks() {
  const up = state.upload;
  if (!up.file || !up.uploadId) throw new ClientError('上传会话不存在');
  const chunkSize = 8 * 1024 * 1024;
  let result = null;
  if (up.offset >= up.file.size) {
    if (!up.confirmed) {
      throw new ClientError(
        '视频没有拍摄时间元数据，请勾选确认拍摄开始时间后继续',
        400,
        'TIME_CONFIRMATION_REQUIRED'
      );
    }
    result = await api(`/api/uploads/${encodeURIComponent(up.uploadId)}/confirm-time`, {
      method: 'POST',
      body: { startedAt: String(up.startedAt || '').replace('T', ' ') }
    });
    up.offset = Number(result.receivedBytes || up.file.size);
  }
  while (up.offset < up.file.size) {
    if (up.abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(up.file.size, up.offset + chunkSize);
    const chunk = up.file.slice(up.offset, end);
    try {
      result = await api(`/api/uploads/${encodeURIComponent(up.uploadId)}/content`, {
        method: 'PUT',
        raw: chunk,
        headers: {
          'Upload-Offset': String(up.offset)
        },
        signal: up.abortController.signal
      });
      up.offset = Number(result.receivedBytes);
      up.progress = Math.min(100, up.offset / up.file.size * 100);
      up.status = up.offset >= up.file.size ? '正在校验文件并创建任务' : `正在上传 ${formatFileSize(up.offset / 1024 / 1024)} / ${formatFileSize(up.file.size / 1024 / 1024)}`;
      await saveUploadSession().catch(() => {});
      render();
    } catch (error) {
      if (error.code === 'UPLOAD_OFFSET_CONFLICT' || error.status === 409) {
        const current = await api(`/api/uploads/${encodeURIComponent(up.uploadId)}`);
        up.offset = Number(current.receivedBytes || 0);
        up.progress = up.file.size ? up.offset / up.file.size * 100 : 0;
        render();
        continue;
      }
      throw error;
    }
  }
  if (!result) {
    result = await api(`/api/uploads/${encodeURIComponent(up.uploadId)}`);
  }
  up.progress = 100;
  up.busy = false;
  up.abortController = null;
  up.status = '上传与分析任务创建完成';
  up.message = `文件 SHA-256 校验通过，已创建任务 ${result.taskId}。系统将按上传顺序串行分析。`;
  up.completedTaskId = result.taskId || '';
  up.sha256 = result.sha256 || result.sha || '';
  await clearUploadSession();
  toast('视频上传完成，已创建分析任务', 'success');
  await loadState({ renderAfter: false });
  const createdTask = (state.data.tasks || []).find((task) => task.id === up.completedTaskId);
  if (createdTask?.startTime && createdTask.startTime !== String(up.startedAt).replace('T', ' ')) {
    up.message = `文件校验通过，已创建任务 ${result.taskId}。系统已使用视频元数据时间 ${createdTask.startTime} 作为分析基准。`;
    up.metadataStartTime = createdTask.startTime;
  }
  render();
}

async function cancelUpload() {
  const up = state.upload;
  up.abortController?.abort();
  if (up.uploadId) {
    try {
      await api(`/api/uploads/${encodeURIComponent(up.uploadId)}`, { method: 'DELETE' });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }
  up.busy = false;
  up.abortController = null;
  up.status = '上传已取消';
  up.message = '本次上传会话已取消，未创建分析任务。';
  await clearUploadSession();
  render();
}

async function handleEditReadout(id, key) {
  const record = recordDetailById(id);
  if (!record) throw new ClientError('记录不存在');
  showEditReadoutModal(record, key);
}

async function markFieldChecked(id, key) {
  await api(`/api/records/${encodeURIComponent(id)}/check/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: { reason: '人工核对识别截图后确认' }
  });
  toast(`${key.replace(/^RO:/, '')} 已标记核对`, 'success');
  await refreshAndRender();
}

async function saveRemark(id) {
  const textarea = document.querySelector(`.record-remark[data-record="${CSS.escape(id)}"]`);
  if (!textarea) return;
  await api(`/api/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      field: 'remark',
      value: textarea.value.trim() || '无',
      reason: '保存备注'
    }
  });
  toast('备注已保存并留痕', 'success');
  await refreshAndRender();
}

async function updateRecordField(recordId, field, value) {
  const record = recordDetailById(recordId);
  if (!record) throw new ClientError('记录不存在');
  const body = {
    field,
    value,
    reason: `记录核对页修改${field === 'box' ? '砝码盒编号' : '视觉复核确认项'}`
  };
  try {
    await api(`/api/records/${encodeURIComponent(recordId)}`, { method: 'PATCH', body });
  } catch (error) {
    if (field === 'box' && error.code === 'BOX_NOT_FOUND') {
      const add = await new Promise((resolve) => {
        openModal({
          title: '新增砝码盒字典项',
          body: `<div class="alert warn">砝码盒 <b class="mono">${esc(value)}</b> 不在字典中。是否确认现场使用并新增为启用字典项？</div>`,
          primary: '确认新增并保存',
          onConfirm: async () => {
            closeModal();
            resolve(true);
          }
        });
        modalRoot.querySelector('[data-modal-close]')?.addEventListener('click', () => resolve(false), { once: true });
      });
      if (!add) await refreshAndRender();
      if (!add) return;
      await api(`/api/records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH',
        body: { ...body, createBox: true }
      });
    } else {
      throw error;
    }
  }
  toast('字段已保存，修改前后值与理由已写入追溯链', 'success');
  await refreshAndRender();
}

async function handleAction(action, element) {
  const id = element.dataset.id || '';
  switch (action) {
    case 'retry-boot':
      boot();
      return;
    case 'refresh-login-captcha': {
      const account = document.getElementById('login-account')?.value?.trim() || lastLoginAccount;
      if (!account) {
        toast('请先填写账号编号', 'warn');
        return;
      }
      await withBusy(element, async () => {
        loginCaptcha = await api(
          `/api/auth/captcha?account=${encodeURIComponent(account)}`,
          { allowUnauthorized: true }
        );
        lastLoginAccount = account;
        renderLogin();
      });
      return;
    }
    case 'toggle-sidebar':
      state.ui.sidebarOpen = !state.ui.sidebarOpen;
      document.getElementById('sidebar')?.classList.toggle('open', state.ui.sidebarOpen);
      return;
    case 'logout': {
      try {
        await api('/api/auth/logout', { method: 'POST', body: {} });
      } catch {
        // Local session still needs to be cleared if the server session already expired.
      }
      state.data = null;
      state.session = null;
      state.csrfToken = '';
      closeModal();
      window.location.hash = '#/login';
      renderLogin('已安全退出。');
      return;
    }
    case 'upload-clear':
      if (state.upload.uploadId) {
        try {
          await api(`/api/uploads/${encodeURIComponent(state.upload.uploadId)}`, {
            method: 'DELETE'
          });
        } catch {
          // The server may already have finished the session; local state is still cleared.
        }
      }
      await clearUploadSession();
      state.upload.file = null;
      state.upload.uploadId = null;
      state.upload.offset = 0;
      state.upload.progress = 0;
      state.upload.status = '';
      state.upload.message = '';
      state.upload.completedTaskId = '';
      state.upload.duplicateWarning = '';
      state.upload.metadataStartTime = '';
      state.upload.expectedDeviceId = '';
      render();
      return;
    case 'upload-start':
      await withBusy(element, startUpload);
      return;
    case 'upload-cancel':
      await cancelUpload();
      return;
    case 'task-cancel':
      await api(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
      toast('排队任务已取消并写入审计日志', 'warn');
      await refreshAndRender();
      return;
    case 'task-retry':
      await api(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} });
      toast('任务已重新排队；重试复用原任务编号', 'success');
      await refreshAndRender();
      return;
    case 'task-manual': {
      const task = state.data.tasks.find((candidate) => candidate.id === id);
      if (task) showManualTaskModal(task);
      return;
    }
    case 'refresh-data':
      await refreshAndRender();
      toast('数据已刷新', 'success');
      return;
    case 'edit-readout':
      await handleEditReadout(id, element.dataset.key || '');
      return;
    case 'check-readout':
      await markFieldChecked(id, `RO:${element.dataset.key}`);
      return;
    case 'frame-evidence': {
      const record = recordDetailById(id);
      if (record) showFrameEvidenceModal(record, element.dataset.key || '');
      return;
    }
    case 'frame-play': {
      closeModal();
      const video = document.getElementById('record-video');
      if (!video) return;
      video.currentTime = Math.max(0, Number(element.dataset.off || 0));
      video.play().catch(() => {});
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    case 'jump-video': {
      const video = document.getElementById('record-video');
      if (!video) return;
      video.currentTime = Math.max(0, Number(element.dataset.off || 0));
      video.play().catch(() => {});
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    case 'save-remark':
      await withBusy(element, () => saveRemark(id));
      return;
    case 'submit-record': {
      const record = recordDetailById(id);
      if (record) showSubmitModal(record);
      return;
    }
    case 'confirm-record': {
      const record = recordDetailById(id);
      if (!record) return;
      confirmModal({
        title: `电子签名确认 ${id}`,
        message: `复核确认人：${state.data.user.name}。签名后全部字段锁定，如需更正只能由管理员作废并重新拍摄校验。`,
        primary: '确认并签名',
        onConfirm: async () => {
          await api(`/api/records/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {} });
          closeModal();
          toast('复核确认完成，记录已锁定', 'success');
          await refreshAndRender();
        }
      });
      return;
    }
    case 'reject-record':
      openModal({
        title: `退回记录 ${id}`,
        subtitle: '退回后记录回到待提交状态，将通知原检验人员',
        body: `<div class="field"><label>退回理由（可选）</label><textarea name="reason" placeholder="说明需要核对或修改的位置"></textarea></div>`,
        primary: '确认退回',
        onConfirm: async (form) => {
          const data = formObject(form);
          await api(`/api/records/${encodeURIComponent(id)}/reject`, {
            method: 'POST',
            body: { reason: data.reason?.trim() || '' }
          });
          closeModal();
          toast('记录已退回检验人员修改', 'warn');
          await refreshAndRender();
        }
      });
      return;
    case 'void-record':
      openModal({
        title: `作废记录 ${id}`,
        subtitle: '记录将保持只读、标注“已作废”，不参与统计与批量导出',
        body: `<div class="field"><label class="required">作废理由</label><textarea name="reason" required placeholder="例如：砝码盒编号填写错误，需重新拍摄校验"></textarea></div>`,
        primary: '确认作废',
        danger: true,
        onConfirm: async (form) => {
          const data = formObject(form);
          if (!data.reason?.trim()) throw new ClientError('请填写作废理由');
          await api(`/api/records/${encodeURIComponent(id)}/void`, {
            method: 'POST',
            body: { reason: data.reason.trim() }
          });
          closeModal();
          toast('记录已作废并写入审计日志', 'warn');
          await refreshAndRender();
        }
      });
      return;
    case 'export-record': {
      const record = recordDetailById(id);
      if (!record) return;
      await withBusy(element, async () => {
        await downloadFromApi(
          `/api/exports/record/${encodeURIComponent(id)}`,
          {},
          `天平校验记录_${record.device}_${record.date.replaceAll('-', '')}.pdf`
        );
        toast('PDF 已生成并开始下载', 'success');
      });
      return;
    }
    case 'qr-download-person':
    case 'qr-download-person-png': {
      await withBusy(element, async () => {
        await downloadIdentityCard(
          `/api/qr/person.svg?account=${encodeURIComponent(state.data.user.id)}`,
          `人员二维码_${state.data.user.id}.${action.endsWith('-png') ? 'png' : 'svg'}`,
          action.endsWith('-png') ? 'png' : 'svg'
        );
      });
      toast('人员身份卡已下载', 'success');
      return;
    }
    case 'qr-download-person-admin': {
      await withBusy(element, async () => {
        await downloadIdentityCard(
          `/api/qr/person.svg?account=${encodeURIComponent(id)}`,
          `人员二维码_${id}.svg`,
          'svg'
        );
      });
      toast(`人员 ${id} 身份卡已下载`, 'success');
      return;
    }
    case 'qr-download-device':
    case 'qr-download-device-png': {
      await withBusy(element, async () => {
        await downloadIdentityCard(
          `/api/qr/device/${encodeURIComponent(id)}.svg`,
          `天平二维码_${id}.${action.endsWith('-png') ? 'png' : 'svg'}`,
          action.endsWith('-png') ? 'png' : 'svg'
        );
      });
      toast(`天平 ${id} 设备卡已下载`, 'success');
      return;
    }
    case 'download-sop':
      await withBusy(element, async () => {
        await downloadFromApi('/api/docs/sop.pdf', null, '天平校验视频分析系统_标准操作流程.pdf', 'GET');
      });
      toast('标准操作流程 PDF 已下载', 'success');
      return;
    case 'download-week-pdf': {
      const query = parseRoute().query;
      const device = query.get('device') || '';
      const week = query.get('week') || naturalWeekRange().week;
      await withBusy(element, async () => {
        await downloadFromApi(
          '/api/exports/week',
          { device, week },
          `天平校验周统计_${device}_${week.replaceAll('-', '')}.pdf`
        );
      });
      toast('周统计 PDF 已下载', 'success');
      return;
    }
    case 'preview-week': {
      const form = element.closest('form[data-form="export-week"]');
      if (!form) return;
      const data = formObject(form);
      if (!data.device || !data.week) {
        toast('请选择天平和校验周', 'warn');
        return;
      }
      navigate(`/print/week?device=${encodeURIComponent(data.device)}&week=${encodeURIComponent(data.week)}`);
      return;
    }
    case 'export-records-csv':
      await withBusy(element, async () => {
        await downloadFromApi('/api/exports/csv', {
          type: 'records',
          devices: state.filters.records.devices,
          from: state.filters.records.from || undefined,
          to: state.filters.records.to || undefined,
          inspector: state.filters.records.inspector || undefined,
          status: state.filters.records.status || undefined,
          conclusion: state.filters.records.conclusion || undefined
        }, '天平校验记录清单.csv');
        toast('记录清单 CSV 已开始下载', 'success');
      });
      return;
    case 'history-csv':
      await withBusy(element, async () => {
        const filters = state.filters.history;
        await downloadFromApi('/api/exports/csv', {
          type: 'readouts',
          devices: [element.dataset.device],
          from: filters.from || undefined,
          to: filters.to || undefined,
          conclusion: filters.conclusion || undefined
        }, `天平校验示值明细_${element.dataset.device}.csv`);
        toast('示值明细 CSV 已开始下载', 'success');
      });
      return;
    case 'master-tab':
      state.ui.masterTab = ['boxes', 'dictionaries'].includes(element.dataset.tab)
        ? element.dataset.tab
        : 'devices';
      render();
      return;
    case 'device-directory-reset':
      state.ui.deviceDirectoryQuery = '';
      render();
      return;
    case 'device-new':
      showDeviceModal();
      return;
    case 'device-edit': {
      const device = deviceById(id);
      if (device) showDeviceModal(device);
      return;
    }
    case 'box-new':
      showBoxModal();
      return;
    case 'dictionary-new':
      showDictionaryModal();
      return;
    case 'dictionary-edit': {
      const item = (state.data.dictionaries || []).find(
        (candidate) => String(candidate.id) === String(id)
      );
      if (item) showDictionaryModal(item);
      return;
    }
    case 'box-edit': {
      const box = state.data.weightBoxes.find((candidate) => candidate.id === id);
      if (box) showBoxModal(box);
      return;
    }
    case 'recommend-points': {
      const form = modalRoot.querySelector('#modal-form');
      if (!form) return;
      const rangeCount = Number(form.querySelector('[name="ranges"]')?.value);
      const range1Max = Number(form.querySelector('[name="range1Max"]')?.value) || 220;
      const range2Max = Number(form.querySelector('[name="range2Max"]')?.value) || 40;
      const lowerNice = (value) => {
        const candidates = [];
        for (let exponent = -1; exponent <= 5; exponent += 1) {
          for (const multiplier of [1, 2, 5]) candidates.push(multiplier * 10 ** exponent);
        }
        return candidates.filter((candidate) => candidate <= value).sort((a, b) => b - a)[0] || value;
      };
      const points = rangeCount === 2
        ? [lowerNice(range1Max * 5 / 6), lowerNice(range2Max / 2), lowerNice(range2Max / 20)]
        : (() => {
          const first = lowerNice(range1Max * 10 / 11);
          return [first, lowerNice(first / 4), lowerNice(first / 20)];
        })();
      points.forEach((point, index) => {
        const input = form.querySelector(`[name="point${index + 1}"]`);
        if (input) input.value = point;
      });
      toast(`已推荐标称点 ${points.join(' / ')} g`, 'success');
      return;
    }
    case 'export-devices-csv':
      await withBusy(element, async () => {
        await downloadFromApi('/api/exports/csv', { type: 'devices' }, '天平清单.csv');
        toast('天平清单 CSV 已开始下载', 'success');
      });
      return;
    case 'template-reset':
      confirmModal({
        title: '恢复默认记录模板',
        message: '将生成新模板版本并写入审计日志；已复核确认记录继续使用其生成时的模板快照。',
        primary: '确认恢复',
        danger: true,
        onConfirm: async () => {
          await api('/api/templates', {
            method: 'POST',
            body: { reset: true, summary: '恢复默认模板（二次确认）' }
          });
          closeModal();
          toast('已恢复默认模板并生成新版本', 'warn');
          await refreshAndRender();
        }
      });
      return;
    case 'export-csv': {
      const type = element.dataset.type || 'records';
      const form = document.querySelector('[data-form="export-batch"]');
      const devices = selectedValues('devices');
      if (!devices.length) {
        toast('请至少选择一台天平', 'warn');
        return;
      }
      const data = form ? formObject(form) : {};
      await withBusy(element, async () => {
        await downloadFromApi('/api/exports/csv', {
          type,
          devices,
          from: data.from || undefined,
          to: data.to || undefined
        }, `天平校验_${type}.csv`);
        toast('CSV 已生成并开始下载', 'success');
      });
      return;
    }
    case 'account-new':
      showAccountModal();
      return;
    case 'account-edit': {
      const account = state.data.accounts.find((candidate) => candidate.id === id);
      if (account) showAccountModal(account);
      return;
    }
    case 'account-reset':
      confirmModal({
        title: `重置口令 ${id}`,
        message: '账号所有活动会话将失效；下次登录使用系统初始口令并被强制修改。操作将写入审计日志。',
        primary: '确认重置',
        danger: true,
        onConfirm: async () => {
          const result = await api(`/api/accounts/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: {} });
          openModal({
            title: `账号 ${id} 口令已重置`,
            subtitle: '临时口令只在此处展示一次',
            body: `<div class="alert warn">一次性临时口令：<b class="mono">${esc(result.temporaryPassword || '（服务端未返回，请联系管理员）')}</b></div>
              <p class="muted">账号下次登录时必须修改口令；此前所有活动会话均已失效。</p>`,
            primary: '我已妥善记录',
            onConfirm: async () => {
              closeModal();
              await refreshAndRender();
            }
          });
        }
      });
      return;
    case 'account-delete':
      confirmModal({
        title: `删除账号 ${id}`,
        message: '将移除账号登录能力并终止会话，历史记录与审计日志保持可查。若只是暂停使用，建议改为停用。',
        primary: '确认删除',
        danger: true,
        onConfirm: async () => {
          await api(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
          closeModal();
          toast('账号已删除，历史记录未受影响', 'warn');
          await refreshAndRender();
        }
      });
      return;
    case 'audit-page':
      state.ui.auditPage = Math.max(1, Number(element.dataset.page || 1));
      render();
      return;
    case 'records-page':
      await loadRecordsPage(Math.max(1, Number(element.dataset.page || 1)));
      return;
    case 'verify-page':
      await loadVerifyRecords(Math.max(1, Number(element.dataset.page || 1)));
      return;
    case 'history-page':
      await loadHistoryRecords(
        element.dataset.device,
        Math.max(1, Number(element.dataset.page || 1))
      );
      return;
    case 'reset-record-filter':
      state.filters.records = { devices: [], from: '', to: '', inspector: '', status: '', conclusion: '' };
      state.recordsView.loaded = false;
      state.recordsView.page = 1;
      await loadRecordsPage(1);
      return;
    case 'reset-history-filter': {
      const deviceId = element.dataset.device;
      state.filters.history = { from: '', to: '', conclusion: '' };
      state.historyView.loaded = false;
      state.historyView.page = 1;
      await loadHistoryRecords(deviceId, 1);
      return;
    }
    case 'reset-verify-filter':
      state.filters.verify = { device: '', from: '', to: '', inspector: '' };
      state.verifyView.loaded = false;
      state.verifyView.page = 1;
      await loadVerifyRecords(1);
      return;
    case 'reset-audit-filter':
      state.filters.audit = { from: '', to: '', account: '', type: '' };
      state.ui.auditPage = 1;
      render();
      return;
    case 'export-audit':
      await withBusy(element, async () => {
        await downloadAuditCsv();
        toast('审计日志 CSV 已开始下载，导出动作本身也已留痕', 'success');
        await loadState({ renderAfter: false });
      });
      return;
    case 'backup-run':
      await withBusy(element, async () => {
        const result = await api('/api/system/backup', { method: 'POST', body: {} });
        toast(`数据库备份完成${result?.fileName ? `：${result.fileName}` : ''}`, 'success');
        await refreshAndRender();
      });
      return;
    case 'cleanup-videos':
      confirmModal({
        title: '执行视频容量清理',
        message: '系统将按“最早优先”清理超出配额的最旧原始视频。记录、截图、PDF 与审计日志不会被删除。',
        primary: '开始清理',
        danger: true,
        onConfirm: async () => {
          const result = await api('/api/system/cleanup', { method: 'POST', body: {} });
          closeModal();
          toast(`容量清理完成，清理 ${Number(result.cleaned?.length || result.cleaned?.count || 0)} 个视频文件`, 'success');
          await refreshAndRender();
        }
      });
      return;
    case 'health-check':
      await withBusy(element, async () => {
        const result = await api('/healthz', { allowUnauthorized: true });
        toast(`健康检查通过：服务 ${result.status}，数据库 ${result.database}`, result.status === 'ok' ? 'success' : 'warn');
      });
      return;
    case 'system-refresh':
      await refreshAndRender();
      toast('运行状态已刷新', 'success');
      return;
    case 'export-app-logs':
      await withBusy(element, async () => {
        await downloadFromApi(
          '/api/system/logs?download=1',
          null,
          '应用日志.log',
          'GET'
        );
        toast('应用日志已导出，导出动作已写入审计日志', 'success');
      });
      return;
    case 'print-window':
      window.print();
      return;
    default:
      return;
  }
}

function updateTemplatePreview(form) {
  const preview = document.querySelector('[data-template-preview]');
  if (!preview || !form) return;
  const fields = (state.data.template.fields || []).map((field) => {
    const showInput = form.querySelector(`[name="show_${field.key}"]`);
    const labelInput = form.querySelector(`[name="label_${field.key}"]`);
    return {
      ...field,
      show: showInput ? showInput.checked : field.show,
      label: labelInput?.value.trim() || field.label
    };
  });
  const fieldsRoot = preview.querySelector('[data-preview-fields]');
  if (fieldsRoot) {
    fieldsRoot.innerHTML = fields
      .filter((field) => field.show !== false && !['time', 'detail'].includes(field.key))
      .map((field) => `<span>${esc(field.label)}</span><b>示例</b>`)
      .join('');
  }
  const timeField = fields.find((field) => field.key === 'time');
  const pointsRoot = preview.querySelector('[data-preview-points]');
  if (pointsRoot) {
    pointsRoot.textContent = ['point1', 'point2', 'point3']
      .map((name, index) => {
        const value = form.querySelector(`[name="${name}"]`)?.value;
        return `L${index + 1}=${value || '—'}g`;
      })
      .join(' · ') + (
        form.querySelector('[name="useTemplatePoints"]')?.checked
          ? ' · 判定使用模板值'
          : ' · 判定使用设备档案值'
      );
  }
  const timeRoot = preview.querySelector('[data-preview-time]');
  if (timeRoot) {
    timeRoot.textContent = form.querySelector('[name="printTime"]')?.checked === false
      || timeField?.show === false
      ? '不打印测量时间'
      : `打印测量时间：${timeField?.label || '测量时间'}`;
  }
  const footerRoot = preview.querySelector('[data-preview-footer]');
  if (footerRoot) {
    footerRoot.textContent = form.querySelector('[name="footerExtra"]')?.value
      || form.querySelector('[name="footerNote"]')?.value
      || '';
  }
}

async function handleForm(form) {
  const type = form.dataset.form;
  if (type === 'login') {
    const submit = form.querySelector('[data-submit-label]');
    await withBusy(submit, async () => {
      const data = formObject(form);
      if (!data.account?.trim() || !data.password) throw new ClientError('请输入账号与口令');
      lastLoginAccount = data.account.trim();
      try {
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: {
            account: data.account.trim(),
            password: data.password,
            captchaToken: data.captchaToken || '',
            captchaAnswer: data.captchaAnswer || ''
          },
          allowUnauthorized: true
        });
        loginCaptcha = null;
        state.session = result.user;
        state.csrfToken = result.csrfToken || '';
        if (result.user.mustChangePassword) {
          renderChangePassword();
          return;
        }
        await loadState({ renderAfter: false });
        await restoreUploadSession();
        navigate('/dashboard');
        toast(`登录成功：${result.user.name}`, 'success');
      } catch (error) {
        if (error.details?.captchaRequired) {
          loginCaptcha = error.details.captcha || loginCaptcha;
          if (!loginCaptcha) {
            try {
              loginCaptcha = await api(
                `/api/auth/captcha?account=${encodeURIComponent(data.account.trim())}`,
                { allowUnauthorized: true }
              );
            } catch {
              // The login error remains the primary message.
            }
          }
        }
        renderLogin(errorMessage(error));
      }
    });
    return;
  }
  if (type === 'qr-device-search') {
    const data = formObject(form);
    const query = String(data.deviceQuery || '').trim().toUpperCase();
    const device = state.data.devices.find((item) => (
      item.id.toUpperCase() === query || String(item.uniqueNo).toUpperCase() === query
    ));
    if (!device) throw new ClientError('未找到对应天平，请检查编号或唯一号');
    if (device.status !== '在用') throw new ClientError(`天平 ${device.id} 已停用，不能生成新设备卡`);
    state.ui.qrDevice = device.id;
    render();
    toast(`已查询天平 ${device.id}`, 'success');
    return;
  }
  if (type === 'device-directory-search') {
    const data = formObject(form);
    state.ui.deviceDirectoryQuery = String(data.query || '').trim();
    render();
    return;
  }
  if (type === 'change-password') {
    const submit = form.querySelector('[data-submit-label]');
    const errorBox = document.getElementById('change-error');
    await withBusy(submit, async () => {
      const data = formObject(form);
      if (data.newPassword !== data.confirmPassword) throw new ClientError('两次输入的新口令不一致');
      if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(data.newPassword)) {
        throw new ClientError('新口令至少 8 位，并同时包含字母和数字');
      }
      await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: data.currentPassword,
          newPassword: data.newPassword
        }
      });
      state.session.mustChangePassword = false;
      await loadState({ renderAfter: false });
      await restoreUploadSession();
      window.location.hash = '#/dashboard';
      render();
      toast('口令修改成功，已进入系统', 'success');
    }).catch((error) => {
      if (errorBox) errorBox.innerHTML = `<div class="alert danger mt12">${esc(errorMessage(error))}</div>`;
    });
    return;
  }
  if (type === 'record-filter') {
    const data = formObject(form);
    state.filters.records = {
      devices: new FormData(form).getAll('devices').map(String),
      from: data.from || '',
      to: data.to || '',
      inspector: data.inspector || '',
      status: data.status || '',
      conclusion: data.conclusion || ''
    };
    state.recordsView.loaded = false;
    state.recordsView.page = 1;
    await loadRecordsPage(1);
    return;
  }
  if (type === 'history-filter') {
    const data = formObject(form);
    const match = /^\/history\/([^/]+)$/.exec(parseRoute().path);
    if (!match) return;
    state.filters.history = {
      from: data.from || '',
      to: data.to || '',
      conclusion: data.conclusion || ''
    };
    state.historyView.loaded = false;
    state.historyView.page = 1;
    await loadHistoryRecords(decodeURIComponent(match[1]), 1);
    return;
  }
  if (type === 'verify-filter') {
    state.filters.verify = {
      ...state.filters.verify,
      ...formObject(form)
    };
    state.verifyView.loaded = false;
    state.verifyView.page = 1;
    await loadVerifyRecords(1);
    return;
  }
  if (type === 'audit-filter') {
    state.filters.audit = {
      ...state.filters.audit,
      ...formObject(form)
    };
    state.ui.auditPage = 1;
    render();
    return;
  }
  if (type === 'template-save') {
    const submit = form.querySelector('[type="submit"]');
    await withBusy(submit, async () => {
      const data = formObject(form);
      const fields = state.data.template.fields.map((field) => {
        const showInput = form.querySelector(`[name="show_${field.key}"]`);
        const labelInput = form.querySelector(`[name="label_${field.key}"]`);
        return {
          ...field,
          show: showInput ? showInput.checked : field.show,
          label: labelInput ? labelInput.value.trim() || field.label : field.label
        };
      });
      await api('/api/templates', {
        method: 'POST',
        body: {
          config: {
            tol: Number(data.tol),
            points: [data.point1, data.point2, data.point3].map(Number),
            printTime: form.querySelector('[name="printTime"]')?.checked === true,
            useTemplatePoints: form.querySelector('[name="useTemplatePoints"]')?.checked === true,
            footerNote: data.footerNote || '',
            footerExtra: data.footerExtra || '',
            fields
          },
          summary: '通过模板配置页保存容差、字段显隐与名称、页脚和测量时间设置'
        }
      });
      toast('模板已保存为新版本；历史记录保持原模板快照', 'success');
      await refreshAndRender();
    });
    return;
  }
  if (type === 'export-batch') {
    const submit = form.querySelector('[type="submit"]');
    const devices = selectedValues('devices');
    if (!devices.length) {
      toast('请至少选择一台天平', 'warn');
      return;
    }
    const data = formObject(form);
    await withBusy(submit, async () => {
      const mode = data.mode || 'merged';
      const extension = mode === 'per-device-day' ? 'zip' : 'pdf';
      await downloadFromApi('/api/exports/records', {
        devices,
        from: data.from,
        to: data.to,
        mode,
        includeUnverified: form.querySelector('[name="includeUnverified"]')?.checked === true
      }, `天平校验记录_${devices.join('-')}_${data.from.replaceAll('-', '')}-${data.to.replaceAll('-', '')}.${extension}`);
      toast(mode === 'per-device-day'
        ? '逐台每日 PDF 文件包已生成并开始下载'
        : '合并 PDF 已生成并开始下载', 'success');
      await loadState({ renderAfter: false });
    });
    return;
  }
  if (type === 'export-week') {
    const submit = form.querySelector('[type="submit"]');
    const data = formObject(form);
    await withBusy(submit, async () => {
      await downloadFromApi('/api/exports/week', {
        device: data.device,
        week: data.week
      }, `天平校验周统计_${data.device}_${data.week.replaceAll('-', '')}.pdf`);
      toast('周统计 PDF 已生成并开始下载', 'success');
      await loadState({ renderAfter: false });
    });
    return;
  }
  if (type === 'system-settings') {
    const submit = form.querySelector('[type="submit"]');
    await withBusy(submit, async () => {
      const data = formObject(form);
      const numeric = {};
      for (const key of [
        'videoQuotaGb', 'capacityWarnPercent', 'confidenceThreshold',
        'sessionIdleMinutes', 'logRetentionDays', 'recordRetentionYears'
      ]) {
        numeric[key] = Number(data[key]);
      }
      await api('/api/system/settings', { method: 'PATCH', body: numeric });
      toast('系统运行参数已保存并写入审计日志', 'success');
      await refreshAndRender();
    });
    return;
  }
}

function wireDynamic() {
  const weekInput = document.querySelector('[data-form="export-week"] input[name="week"]');
  if (weekInput) {
    const rangeText = weekInput.closest('form')?.querySelector('[data-week-range]');
    const updateWeekRange = () => {
      const range = weekRangeFromIso(weekInput.value);
      if (rangeText) rangeText.textContent = `当前：${range.from} 至 ${range.to}（周一至周日）`;
    };
    weekInput.addEventListener('input', updateWeekRange);
    weekInput.addEventListener('change', updateWeekRange);
    updateWeekRange();
  }
  const dropzone = document.getElementById('upload-dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => document.getElementById('video-file')?.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        document.getElementById('video-file')?.click();
      }
    });
    for (const type of ['dragenter', 'dragover']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('dragging');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragging');
      });
    }
    dropzone.addEventListener('drop', (event) => {
      chooseVideoFile(event.dataTransfer?.files?.[0]);
    });
  }
  const video = document.getElementById('record-video');
  if (video) {
    video.addEventListener('error', () => {
      const panel = document.getElementById('video-panel');
      if (panel) {
        panel.innerHTML = `<div class="video-placeholder">原始视频已按容量策略清理或当前浏览器无法播放。<br>校验记录、识别截图与审计信息仍完整可查。</div>`;
      }
    });
  }
  const rangeSelect = document.getElementById('device-ranges');
  if (rangeSelect) {
    const toggleRangeFields = () => {
      const isTwo = rangeSelect.value === '2';
      const maxField = document.getElementById('range2-max-field');
      const dField = document.getElementById('range2-d-field');
      if (maxField) maxField.style.opacity = isTwo ? '1' : '.45';
      if (dField) dField.style.opacity = isTwo ? '1' : '.45';
    };
    rangeSelect.addEventListener('change', toggleRangeFields);
    toggleRangeFields();
  }
}

document.addEventListener('click', async (event) => {
  const close = event.target.closest('[data-modal-close]');
  if (close) {
    closeModal();
    return;
  }
  if (event.target.matches('[data-modal-background]')) {
    closeModal();
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  event.preventDefault();
  try {
    await handleAction(control.dataset.action, control);
  } catch (error) {
    if (error?.status === 401) return;
    toast(errorMessage(error), 'error', 5200);
    if (error?.details && Array.isArray(error.details)) {
      error.details.forEach((line) => toast(String(line), 'warn', 5600));
    }
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'modal-form') {
    const modal = state.modal;
    if (!modal?.onConfirm) return;
    const submit = form.querySelector('[type="submit"]');
    try {
      await withBusy(submit, () => modal.onConfirm(form));
    } catch (error) {
      toast(errorMessage(error), 'error', 5200);
    }
    return;
  }
  if (!form.dataset.form) return;
  try {
    await handleForm(form);
  } catch (error) {
    toast(errorMessage(error), 'error', 5200);
  }
});

document.addEventListener('change', async (event) => {
  const target = event.target;
  const templateForm = target.closest?.('[data-form="template-save"]');
  if (templateForm) updateTemplatePreview(templateForm);
  if (target.id === 'video-file') {
    chooseVideoFile(target.files?.[0]);
    return;
  }
  if (target.id === 'upload-start') {
    state.upload.startedAt = target.value;
    return;
  }
  if (target.id === 'upload-device') {
    state.upload.expectedDeviceId = target.value;
    return;
  }
  if (target.name === 'timeConfirmed') {
    state.upload.confirmed = target.checked;
    await saveUploadSession().catch(() => {});
    render();
    return;
  }
  const recordField = target.closest('.record-field');
  if (recordField) {
    try {
      await updateRecordField(
        recordField.dataset.record,
        recordField.dataset.field,
        target.value.trim()
      );
    } catch (error) {
      toast(errorMessage(error), 'error', 5200);
      await refreshAndRender();
    }
  }
});

document.addEventListener('input', (event) => {
  const templateForm = event.target.closest?.('[data-form="template-save"]');
  if (templateForm) updateTemplatePreview(templateForm);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.children.length) closeModal();
});

window.addEventListener('hashchange', () => {
  if (!state.data?.user) {
    if (state.session?.mustChangePassword) renderChangePassword();
    else renderLogin();
    return;
  }
  if (parseRoute().path === '/records') state.recordsView.loaded = false;
  if (parseRoute().path === '/verify') state.verifyView.loaded = false;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

window.setInterval(async () => {
  if (!state.data?.user || document.hidden || modalRoot.children.length) return;
  const path = parseRoute().path;
  if (!['/dashboard', '/tasks'].includes(path)) return;
  try {
    const result = await api(`/api/tasks?scope=${isRole('inspector') ? 'own' : 'all'}`);
    const tasks = result.items || [];
    const before = JSON.stringify(state.data.tasks || []);
    if (JSON.stringify(tasks) !== before) {
      state.data.tasks = tasks;
      state.data.queue = {
        ...(state.data.queue || {}),
        queued: tasks.filter((task) => task.status === '排队中').length,
        running: tasks.some((task) => task.status === '分析中')
      };
      const completedWithoutRecord = tasks.some((task) => (
        task.status === '已完成'
        && task.recordId
        && !recordById(task.recordId)
      ));
      if (completedWithoutRecord) await loadState({ renderAfter: false });
      render();
    }
  } catch {
    // Polling failures are surfaced by explicit user actions or the next full refresh.
  }
}, 3500);

boot();
