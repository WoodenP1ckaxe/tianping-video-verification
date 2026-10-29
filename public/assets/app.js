/* global window, document, fetch, URLSearchParams, Blob, File */

const root = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

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
    recordPage: 1,
    auditPage: 1
  },
  filters: {
    records: {
      device: '',
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
    audit: {
      from: '',
      to: '',
      account: '',
      type: ''
    }
  },
  upload: {
    file: null,
    startedAt: '',
    confirmed: false,
    uploadId: null,
    offset: 0,
    progress: 0,
    status: '',
    message: '',
    abortController: null,
    busy: false,
    completedTaskId: '',
    sha256: ''
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
  return value >= 1 ? `${value.toFixed(1)} MB` : `${Math.round(value * 1024)} KB`;
}

function formatDuration(milliseconds) {
  const ms = Number(milliseconds);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
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
    await loadState();
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
  const accounts = [
    ['U000', '系统管理员', 'admin'],
    ['U001', '李一', 'inspector'],
    ['U002', '李二', 'inspector'],
    ['U003', '齐一', 'verifier']
  ];
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
        <div class="feature-grid">
          <div class="feature"><b>01 · 本地离线</b><span>数据不出内网，不依赖在线识别或云存储。</span></div>
          <div class="feature"><b>02 · 可复算判定</b><span>按容差系数、精度分度与九次读数唯一复算。</span></div>
          <div class="feature"><b>03 · 全程留痕</b><span>修改前后值、操作者、时间、理由与来源终端完整记录。</span></div>
        </div>
      </section>
      <section class="login-panel">
        <h2>登录工作台</h2>
        <p>使用账号与口令登录。初始账号首次登录后必须改密。</p>
        ${message ? `<div class="alert danger">${esc(message)}</div>` : ''}
        <form class="mt16" data-form="login">
          <div class="field">
            <label for="login-account" class="required">账号编号</label>
            <input id="login-account" name="account" autocomplete="username" required maxlength="20" placeholder="例如 U001">
          </div>
          <div class="field mt12">
            <label for="login-password" class="required">口令</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="请输入登录口令">
          </div>
          <button class="btn btn-primary btn-lg btn-block mt16" type="submit" data-submit-label>安全登录</button>
        </form>
        <div class="login-divider">演示账号快捷填入</div>
        <div class="account-cards">
          ${accounts.map(([id, name, role]) => `
            <button type="button" class="account-card" data-action="fill-account" data-account="${id}">
              <span class="account-avatar">${esc(name.slice(0, 1))}</span>
              <span><strong>${esc(name)} · ${esc(id)}</strong><span>${esc(roleLabel(role))}</span></span>
              ${tag(roleLabel(role), role === 'admin' ? 'gray' : role === 'verifier' ? 'violet' : 'blue')}
            </button>`).join('')}
        </div>
        <p class="account-note mt16">初始口令由部署人员提供。非容器方式全新安装时，可读取数据目录下受保护的 <code>initial-password.txt</code>；首次登录会强制设置至少 8 位、同时含字母和数字的新口令，连续输错 5 次锁定 10 分钟。</p>
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
  const pendingVerify = state.data?.records?.filter((record) => record.status === '已提交').length || 0;
  const myDrafts = state.data?.records?.filter(
    (record) => record.status === '待提交' && record.inspector === state.data?.user?.id
  ).length || 0;
  const groups = [
    {
      label: '业务工作',
      items: [
        { path: '/dashboard', label: '工作台', icon: 'dashboard' },
        { path: '/records', label: '校验记录', icon: 'records' },
        { path: '/export', label: '导出与打印', icon: 'download' }
      ]
    }
  ];
  if (isRole('inspector')) {
    groups[0].items.splice(1, 0,
      { path: '/upload', label: '上传校验视频', icon: 'upload' },
      { path: '/tasks', label: '我的分析任务', icon: 'tasks', badge: queueCount || null },
      { path: '/records', href: '/records?draft=1', label: '记录核对', icon: 'check', badge: myDrafts || null }
    );
    groups[0].items = groups[0].items.filter((item, index, list) => (
      item.label !== '校验记录' || index === list.findIndex((candidate) => candidate.label === '记录核对')
    ));
  } else if (isRole('verifier')) {
    groups[0].items.splice(1, 0,
      { path: '/verify', label: '待复核', icon: 'check', badge: pendingVerify || null },
      { path: '/masterdata', label: '天平与砝码盒', icon: 'database' },
      { path: '/template', label: '记录模板', icon: 'template' }
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
  const today = todayText();
  const todayRecords = records.filter((record) => record.date === today);
  const pendingDrafts = records.filter(
    (record) => record.status === '待提交' && (isRole('inspector') ? record.inspector === state.data.user.id : true)
  );
  const pendingVerify = records.filter((record) => record.status === '已提交');
  const failedTasks = (state.data.tasks || []).filter((task) => task.status === '失败' || task.status === '待人工处理');
  const stats = isRole('inspector')
    ? [
      ['今日已上传', todayRecords.filter((record) => record.inspector === state.data.user.id).length, '条校验记录', 'blue'],
      ['待核对提交', pendingDrafts.filter((record) => record.inspector === state.data.user.id).length, '条记录等待电子确认', 'amber'],
      ['分析队列', state.data.queue?.queued || 0, '段视频排队中', 'violet'],
      ['最近异常', failedTasks.filter((task) => task.user === state.data.user.id).length, '项任务需关注', 'red']
    ]
    : isRole('verifier')
      ? [
        ['待复核记录', pendingVerify.length, '条记录等待电子签名', 'amber'],
        ['今日完成校验', todayRecords.length, '条日常校验记录', 'blue'],
        ['本月已复核', records.filter((record) => record.status === '已复核确认').length, '条可正式导出', 'green'],
        ['异常记录', records.filter((record) => recordEvaluation(record)?.conclusion === '不通过').length, '条含判定不满足项', 'red']
      ]
      : [
        ['分析队列', state.data.queue?.queued || 0, '段等待分析', 'blue'],
        ['待复核', pendingVerify.length, '条记录等待复核', 'amber'],
        ['今日记录', todayRecords.length, '条已生成校验记录', 'green'],
        ['异常任务', failedTasks.length, '项失败或待人工处理', 'red']
      ];
  const recent = records
    .filter((record) => isRole('inspector') || record.status !== '待提交' || record.inspector === state.data.user.id)
    .slice(0, 7);
  const tasks = (state.data.tasks || []).slice(0, 5);
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
          ${tasks.length ? tasks.map((task, index) => `
            <div class="queue-item">
              <span class="queue-pos">${index + 1}</span>
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
          <th>校验日期</th><th>天平编号</th><th>检验人员</th><th>砝码盒</th>
          <th>判定</th><th>状态</th><th>提交时间</th><th></th>
        </tr></thead>
        <tbody>${records.slice(0, limit).map((record) => `
          <tr class="${record.status === '已作废' ? 'row-muted' : ''}">
            <td class="nowrap num">${esc(record.date)}</td>
            <td><a href="#/records/${encodeURIComponent(record.id)}"><b>${esc(record.device)}</b></a>
              <div class="muted small">${esc(record.id)}</div></td>
            <td>${esc(accountName(record.inspector))}</td>
            <td class="num">${esc(record.box || '—')}</td>
            <td>${tag(recordEvaluation(record)?.conclusion || '—')}</td>
            <td>${tag(record.status)}</td>
            <td class="num nowrap">${esc(formatDate(record.submittedAt))}</td>
            <td class="col-actions"><a class="btn btn-ghost btn-sm" href="#/records/${encodeURIComponent(record.id)}">查看</a></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="card-list">
      ${records.slice(0, limit).map((record) => `
        <a class="info-card" href="#/records/${encodeURIComponent(record.id)}">
          <div class="row between"><strong>${esc(record.device)}</strong>${tag(record.status)}</div>
          <h3 class="mt8">${esc(record.id)}</h3>
          <p>${esc(record.date)} · ${esc(accountName(record.inspector))}</p>
          <div class="row between mt8"><span class="muted small">砝码盒 ${esc(record.box || '—')}</span>${tag(recordEvaluation(record)?.conclusion || '—')}</div>
        </a>`).join('')}
    </div>`;
}

function pageUpload() {
  const up = state.upload;
  const rules = state.data.fileRules;
  if (!up.startedAt) up.startedAt = currentDateTimeInput();
  const file = up.file;
  return `${pageHeader('上传校验视频', '上传原始视频并确认拍摄开始时间；服务端按分片接收并计算 SHA-256。')}
    <div class="grid grid-3">
      <section class="card span-2">
        <div class="card-head"><div><h2>选择视频</h2><p>支持手机或 PC 拍摄的 MP4 / MOV 文件</p></div>${file ? `<button class="btn btn-secondary btn-sm" data-action="upload-clear">重新选择</button>` : ''}</div>
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
            <span class="hint">无视频元数据时必须由上传者确认，精确到分钟</span>
          </div>
          <div class="field">
            <label>归属检验人员</label>
            <input value="${attr(state.data.user.name)}（${attr(state.data.user.id)}）" disabled>
          </div>
        </div>
        <label class="row mt12" style="font-size:11px">
          <input type="checkbox" name="timeConfirmed" ${up.confirmed ? 'checked' : ''} ${up.busy ? 'disabled' : ''}>
          <span>我已确认上述拍摄开始时间，提交后作为校验日期及读数时间计算基准。</span>
        </label>
        ${up.status ? `<div class="mt16">
          <div class="progress-label"><span>${esc(up.status)}</span><span class="num">${Math.round(up.progress)}%</span></div>
          <div class="progress"><i style="width:${Math.max(0, Math.min(100, up.progress))}%"></i></div>
          ${up.message ? `<div class="alert ${up.completedTaskId ? 'success' : 'warn'} mt12">${esc(up.message)}</div>` : ''}
        </div>` : ''}
        <div class="row row-wrap mt16">
          <button class="btn btn-primary" data-action="upload-start" ${!file || !up.confirmed || up.busy ? 'disabled' : ''}>
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
            <div><b>04 · 口述次序</b><br>清晰口述“第一次”至“第九次”，语音仅用于辅助校验。</div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>当前识别能力</h2></div>
          <div class="alert">${esc(state.data.system?.env?.analyzerMode || 'sample-manifest')} 模式</div>
          <p class="account-note mt8">三段客户样例可按文件哈希完成确定性演示分析。未知视频会自动进入“待人工处理”，由管理员核对后补录，系统不会伪造识别结果。</p>
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
        ['分析中', tasks.filter((task) => task.status === '分析中').length, '单消费者，最多 1 段'],
        ['已完成', tasks.filter((task) => task.status === '已完成').length, '已生成待提交记录'],
        ['需处理', tasks.filter((task) => ['失败', '待人工处理'].includes(task.status)).length, '失败或需人工补录']
      ].map(([label, value, note], index) => `
        <article class="card stat-card ${index === 1 ? 'violet' : index === 3 ? 'amber' : 'teal'}">
          <div class="stat-label">${esc(label)}</div><div class="stat-value">${Number(value)}</div><div class="stat-note">${esc(note)}</div>
        </article>`).join('')}
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>任务明细</h2><p>队列状态自动刷新；管理员可取消排队任务、重试失败任务或人工补录</p></div>
        <span class="muted small">最近刷新 ${esc(currentDateTimeText())}</span></div>
      ${tasks.length ? `
        <div class="table-wrap desktop-table"><table>
          <thead><tr><th>任务编号</th><th>原始文件</th><th>上传时间</th><th>状态</th><th>记录 / 异常</th><th>耗时</th><th class="col-actions">操作</th></tr></thead>
          <tbody>${tasks.map((task) => `
            <tr class="${['失败','待人工处理'].includes(task.status) ? 'row-danger' : task.status === '已取消' ? 'row-muted' : ''}">
              <td><b class="mono">${esc(task.id)}</b><div class="muted small">${esc(task.user)}</div></td>
              <td>${esc(task.file)}<div class="muted small">${formatFileSize(task.size)}</div></td>
              <td class="num">${esc(formatDate(task.queuedAt))}</td>
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
            <p>${esc(formatDate(task.queuedAt))} · ${esc(task.user)}</p>
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

function filterRecords(records) {
  const filter = state.filters.records;
  const draftOnly = parseRoute().query.get('draft') === '1';
  return records.filter((record) => {
    if (draftOnly && !(record.status === '待提交' && record.inspector === state.data.user.id)) return false;
    if (filter.device && record.device !== filter.device) return false;
    if (filter.from && record.date < filter.from) return false;
    if (filter.to && record.date > filter.to) return false;
    if (filter.inspector && record.inspector !== filter.inspector) return false;
    if (filter.status && record.status !== filter.status) return false;
    if (filter.conclusion && recordEvaluation(record)?.conclusion !== filter.conclusion) return false;
    return true;
  });
}

function pageRecords() {
  const draftOnly = parseRoute().query.get('draft') === '1';
  const records = filterRecords(state.data.records || []);
  const inspectors = state.data.accounts.filter((account) => account.role === 'inspector' && account.status !== '已删除');
  return `${pageHeader(
    draftOnly ? '待核对记录' : '校验记录',
    draftOnly ? '核对低置信读数、口述字段和砝码盒编号后，一键提交。' : '所有角色均可查询全部记录，不作“仅本人记录”限制。',
    `<button class="btn btn-secondary" data-action="export-records-csv">${icon('download')}导出当前清单</button>`
  )}
    <form class="card filterbar" data-form="record-filter">
      <div class="field"><label>天平编号</label><select name="device">
        <option value="">全部天平</option>
        ${state.data.devices.map((device) => `<option value="${attr(device.id)}" ${state.filters.records.device === device.id ? 'selected' : ''}>${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
      </select></div>
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
      <div class="card-head"><div><h2>${records.length} 条记录</h2><p>${draftOnly ? '显示本人待提交记录' : '日期倒序排列，点击编号查看完整证据链'}</p></div>
        <a class="btn btn-ghost btn-sm" href="#/records">清除待提交筛选</a></div>
      ${recordsTable(records)}
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
          <div class="card-head"><h2>口述确认项</h2><span class="muted small">语音候选值</span></div>
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

function pageHistory(deviceId) {
  const device = deviceById(deviceId);
  if (!device) {
    return `${pageHeader('天平历史汇总', '未找到天平档案')}
      <section class="card"><div class="empty"><strong>天平 ${esc(deviceId)} 不存在</strong>请检查天平编号或返回记录列表。</div></section>`;
  }
  const records = state.data.records
    .filter((record) => record.device === deviceId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const active = records.filter((record) => record.status !== '已作废');
  const abnormal = active.filter((record) => recordEvaluation(record)?.conclusion === '不通过');
  return `${pageHeader(
    `${device.id} 历史汇总`,
    `${device.uniqueNo} · ${device.dept} · Max ${device.max}g / d ${device.d}mg`,
    `<a class="btn btn-secondary" href="#/print/week?device=${encodeURIComponent(device.id)}&from=${attr(daysAgoText(6))}&to=${attr(todayText())}">${icon('printer')}本周打印</a>
     <button class="btn btn-secondary" data-action="history-csv" data-device="${attr(device.id)}">${icon('download')}示值明细 CSV</button>`
  )}
    <div class="grid grid-4">
      ${[
        ['历史记录', records.length, '含异常与已作废'],
        ['有效记录', active.length, '已排除作废记录'],
        ['不合格记录', abnormal.length, '异常同样完成复核归档'],
        ['最近校验', records[0]?.date || '—', records[0] ? accountName(records[0].inspector) : '暂无记录']
      ].map(([label, value, note], index) => `
        <article class="card stat-card ${index === 2 ? 'amber' : 'teal'}">
          <div class="stat-label">${esc(label)}</div><div class="stat-value" style="${String(value).length > 8 ? 'font-size:20px' : ''}">${esc(value)}</div><div class="stat-note">${esc(note)}</div>
        </article>`).join('')}
    </div>
    <section class="card mt16">
      <div class="card-head"><div><h2>历史记录</h2><p>按校验日期倒序显示；异常记录在判定列明确标注</p></div></div>
      ${recordsTable(records)}
    </section>
    <section class="card mt16">
      <div class="card-head"><div><h2>示值明细汇总</h2><p>按标称点列出历次示值，不提供图形化趋势曲线</p></div></div>
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

function pageVerify() {
  const filter = state.filters.verify;
  const pending = state.data.records
    .filter((record) => record.status === '已提交')
    .filter((record) => {
      if (filter.device && record.device !== filter.device) return false;
      if (filter.inspector && record.inspector !== filter.inspector) return false;
      const date = record.submittedAt?.slice(0, 10) || '';
      if (filter.from && date < filter.from) return false;
      if (filter.to && date > filter.to) return false;
      return true;
    });
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
      <div class="field"><label>提交开始日期</label><input type="date" name="from" value="${attr(filter.from)}"></div>
      <div class="field"><label>提交结束日期</label><input type="date" name="to" value="${attr(filter.to)}"></div>
      <button class="btn btn-primary" type="submit">筛选</button>
      <button class="btn btn-secondary" type="button" data-action="reset-verify-filter">重置</button>
    </form>
    <div class="alert warn">${pending.length} 条已提交记录等待复核。低置信字段、修改痕迹和原始视频均应在签名前检查。</div>
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
    </div>`;
}

function pageMasterData() {
  const devices = state.data.devices;
  const boxes = state.data.weightBoxes;
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
            <a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史</a>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-list">${devices.map((device) => `
      <div class="info-card">
        <div class="row between"><strong>${esc(device.id)} · ${esc(device.dept)}</strong>${tag(device.status)}</div>
        <p>${esc(device.uniqueNo)} · ${device.ranges === 2 ? '双量程' : '单量程'} · ${esc(device.points.join(' / '))}g</p>
        <div class="btn-group mt8"><a class="btn btn-ghost btn-sm" href="#/history/${encodeURIComponent(device.id)}">历史</a>${write ? `<button class="btn btn-ghost btn-sm" data-action="device-edit" data-id="${attr(device.id)}">编辑</button>` : ''}</div>
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
  return `${pageHeader(
    '天平档案与砝码盒',
    '天平编号唯一；砝码盒仅作使用记录，不与天平建立固定绑定。',
    write ? `<button class="btn btn-primary" data-action="device-new">${icon('plus')}新建天平</button>
      <button class="btn btn-secondary" data-action="box-new">${icon('plus')}新增砝码盒</button>
      <button class="btn btn-secondary" data-action="export-devices-csv">${icon('download')}天平清单</button>` : ''
  )}
    <div class="row between">
      <div class="tabs">
        <button class="tab ${state.ui.masterTab === 'devices' ? 'active' : ''}" data-action="master-tab" data-tab="devices">天平档案 ${devices.length}</button>
        <button class="tab ${state.ui.masterTab === 'boxes' ? 'active' : ''}" data-action="master-tab" data-tab="boxes">砝码盒字典 ${boxes.length}</button>
      </div>
    </div>
    <section class="card mt12">
      <div class="card-head"><div><h2>${state.ui.masterTab === 'devices' ? '天平档案' : '砝码盒字典'}</h2>
        <p>${state.ui.masterTab === 'devices' ? '限度=(1±容差%)×L，小数位按对应量程分度值对齐' : '编号仅含字母与数字，最多 10 位'}</p></div>
      </div>
      ${state.ui.masterTab === 'devices' ? devicesContent : boxesContent}
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
          <div class="field"><label>测量时间</label>
            <label class="row" style="min-height:38px"><input type="checkbox" name="printTime" ${template.printTime !== false ? 'checked' : ''} ${write ? '' : 'disabled'}> 在导出与打印中显示测量时间行</label>
          </div>
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
          <label class="row full" style="font-size:11px"><input type="checkbox" name="includeUnverified"> 同时包含待提交/已提交记录（导出件自动加水印）</label>
        </div>
        <div class="row row-wrap mt16">
          <button type="submit" class="btn btn-primary">${icon('download')}生成合并 PDF</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv" data-type="records">${icon('file')}记录清单 CSV</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv" data-type="readouts">${icon('file')}示值明细 CSV</button>
        </div>
      </form>
      <form class="card" data-form="export-week">
        <div class="card-head"><div><h2>周统计表</h2><p>同一自然周按实际有记录日期成列</p></div>${tag('横向 A4', 'violet')}</div>
        <div class="field"><label>单台天平</label><select name="device" required>
          ${devices.filter((device) => device.status === '在用').map((device) => `<option value="${attr(device.id)}">${esc(device.id)} · ${esc(device.uniqueNo)}</option>`).join('')}
        </select></div>
        <div class="field mt12"><label>周起始日期</label><input type="date" name="from" value="${attr(defaultFrom)}" required></div>
        <div class="field mt12"><label>周结束日期</label><input type="date" name="to" value="${attr(defaultTo)}" required></div>
        <button class="btn btn-primary btn-block mt16" type="submit">${icon('printer')}生成周统计 PDF</button>
        <a class="btn btn-secondary btn-block mt8" href="#/print/week">在浏览器中预览</a>
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
      <div class="card-head"><h2>空白表与卡片清单</h2></div>
      <p class="muted small">用于客户打印现有留档表和人员/设备二维码内容清单。卡片二维码建议使用 H 级纠错并固定在设备正面或侧面。</p>
      <a class="btn btn-secondary mt12" href="#/print/blank">${icon('printer')}打开空白表与卡片清单</a>
    </section>`;
}

function pageAccounts() {
  const accounts = state.data.accounts;
  return `${pageHeader('账号与角色', '一个账号只属于一种角色；账号编号同时作为人员卡二维码内容。',
    `<button class="btn btn-primary" data-action="account-new">${icon('plus')}新增账号</button>`)}
    <section class="card">
      <div class="alert">账号初始口令由部署配置或安全随机生成，不在审计日志中显示。新建或重置账号后会仅在当前对话框展示一次临时口令，首次登录强制改密。</div>
      <div class="table-wrap desktop-table"><table>
        <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>首次改密</th><th>登录锁定</th><th>最近登录</th><th class="col-actions">操作</th></tr></thead>
        <tbody>${accounts.map((account) => `<tr class="${account.status === '已删除' ? 'row-muted' : ''}">
          <td><b class="mono">${esc(account.id)}</b>${account.id === state.data.user.id ? '<div class="muted small">当前登录</div>' : ''}</td>
          <td>${esc(account.name)}</td><td>${tag(roleLabel(account.role), account.role === 'admin' ? 'gray' : account.role === 'verifier' ? 'violet' : 'blue')}</td>
          <td>${tag(account.status)}</td><td>${account.mustChangePassword ? tag('待修改', 'amber') : tag('已设置', 'gray')}</td>
          <td>${account.lockedUntil ? `<span class="danger-text small">${esc(account.lockedUntil)}</span>` : '正常'}</td>
          <td class="num">${esc(formatDate(account.lastLoginAt))}</td>
          <td class="col-actions"><div class="btn-group">
            <button class="btn btn-ghost btn-sm" data-action="account-edit" data-id="${attr(account.id)}">编辑</button>
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
  const backedUp = (system.backups || state.data.backups || [])[0];
  const usage = Number(storage.percent ?? storage.usagePercent ?? storage.usedPercent ?? 0);
  return `${pageHeader('存储与运行状态', '服务健康、分析队列、磁盘容量、备份与配置集中查看。',
    `<button class="btn btn-secondary" data-action="system-refresh">${icon('refresh')}刷新</button>
     <button class="btn btn-secondary" data-action="health-check">${icon('server')}健康检查</button>`)}
    ${usage >= Number(settings.capacityWarnPercent || 90) ? `<div class="alert danger">视频存储已使用 ${formatNumber(usage,1)}%，达到告警阈值；容量满时按最早优先清理视频，电子记录不受影响。</div>` : ''}
    <div class="grid grid-4 mt12">
      ${[
        ['数据库', system.database?.status || '正常', `探测 ${formatNumber(system.database?.latencyMs,2)} ms`, system.database?.status !== '异常'],
        ['分析队列', `${Number(queue.queued || 0)} 段`, queue.running ? '单消费者运行中' : '当前空闲', true],
        ['视频容量', `${formatNumber(storage.usedGb ?? (storage.usedBytes ? storage.usedBytes / 1024 / 1024 / 1024 : 0),1)} GB`, `配额 ${settings.videoQuotaGb || 200} GB`, usage < 100],
        ['最近备份', backedUp ? formatDate(backedUp.time) : '暂无', '数据库与配置快照', Boolean(backedUp)]
      ].map(([label, value, note, ok], index) => `<article class="card stat-card ${ok ? (index === 2 && usage >= 90 ? 'amber' : 'teal') : 'amber'}">
        <div class="stat-label">${esc(label)}</div><div class="stat-value" style="${String(value).length > 12 ? 'font-size:16px' : ''}">${esc(value)}</div><div class="stat-note">${esc(note)}</div>
      </article>`).join('')}
    </div>
    <div class="grid grid-3 mt16">
      <section class="card span-2">
        <div class="card-head"><h2>服务状态</h2><span class="muted small">${esc(system.env?.serverTime || currentDateTimeText())}</span></div>
        ${(system.services || []).map((service) => `<div class="system-service">
          <span class="service-dot ${service.status === '运行中' ? '' : 'bad'}"></span>
          <div class="grow"><strong>${esc(service.name)}</strong><span>${esc(service.detail || '')}</span></div>
          ${tag(service.status)}
        </div>`).join('') || '<div class="empty">暂无服务状态</div>'}
        <div class="alert warn mt16">当前识别适配器：${esc(system.analyzer?.mode || system.env?.analyzerMode || 'sample-manifest')}。未知视频不自动生成记录，须人工补录。</div>
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
            <div class="kv"><span>NTP</span><strong>${esc(system.env?.ntp || '未探测')}</strong></div>
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
    </div>`;
}

function printRecordContent(record) {
  const device = deviceById(record.device) || record.deviceSnapshot || {};
  const evaluation = recordEvaluation(record) || {};
  const itemMap = new Map((evaluation.items || []).map((item) => [item.key, item]));
  const template = record.templateSnapshot || state.data.template || {};
  const watermark = record.status === '已复核确认' ? '' : record.status === '已作废' ? '已作废' : '未复核';
  const readouts = record.readouts || [];
  return `
    ${watermark ? `<div class="print-watermark">${esc(watermark)}</div>` : ''}
    <div class="print-title">电子天平日常校验记录表</div>
    <div class="print-sub">天平编号：${esc(record.device)} · 记录编号：${esc(record.id)}</div>
    <table class="print-grid">
      <tr><td class="label">科室</td><td>${esc(device.dept || '')}</td><td class="label">天平唯一号</td><td>${esc(device.uniqueNo || '')}</td><td class="label">Max / d</td><td>${esc(device.max || '')} g / ${esc(device.d || '')} mg</td></tr>
      <tr><td class="label">内部校正方式</td><td>${esc(device.internalCal || '')}</td><td class="label">校验日期</td><td>${esc(record.date)}</td><td class="label">砝码盒编号</td><td>${esc(record.box || '')}</td></tr>
      <tr><td class="label">清洁</td><td>${esc(record.cleanliness || '')}</td><td class="label">水平调节</td><td>${esc(record.level || '')}</td><td class="label">内部校正通过</td><td>${esc(record.internalCal || '')}</td></tr>
      <tr><td class="label">备注</td><td colspan="5">${esc(record.remark || '无')}</td></tr>
    </table>
    <table class="print-grid" style="margin-top:8px">
      <thead><tr><th>读数</th><th>量程</th><th>L(g)</th><th>限度区间(g)</th><th>示值 I(g)</th><th>偏差(g)</th><th>是否在限内</th>${template.printTime !== false ? '<th>测量时间</th>' : ''}</tr></thead>
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
          ${template.printTime !== false ? `<td>${esc(formatDate(readout.time))}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table>
    <table class="print-grid" style="margin-top:8px">
      <tr><td class="label">外部校正</td><td>${esc(evaluation.conclusion || '')}</td><td class="label">判定依据</td><td>9 次读数均在 (1±${esc(evaluation.tol ?? 0.05)}%)×L 内，稳定、齐全、顺序正确${device.ranges === 2 ? '且完成量程切换' : ''}</td></tr>
    </table>
    <div class="print-sign">
      <div>校验人员：${esc(accountName(record.submittedBy || record.inspector))}<br>签名时间：${esc(formatDate(record.submittedAt))}</div>
      <div>复核确认人：${esc(record.verifiedBy ? accountName(record.verifiedBy) : '')}<br>签名时间：${esc(formatDate(record.verifiedAt))}</div>
    </div>
    <div class="print-note">${esc(template.footerNote || '注：出现异常时应在备注栏准确记录，必要时及时报修。')}<br>${esc(template.footerExtra || '')}<br>导出时间：${esc(currentDateTimeText())} · 模板 ${esc(record.templateVersion || '')}</div>`;
}

function pagePrintRecord(record) {
  return `<div class="print-toolbar app-only"><div><strong>单日校验记录表 · A4 打印预览</strong><div class="muted small">${esc(record.id)}</div></div>
      <div class="row"><a class="btn btn-secondary" href="#/records/${encodeURIComponent(record.id)}">返回详情</a><button class="btn btn-primary" data-action="print-window">${icon('printer')}打印</button></div></div>
    <article class="print-paper">${printRecordContent(record)}</article>`;
}

function pagePrintWeek() {
  const query = parseRoute().query;
  const deviceId = query.get('device') || state.data.devices[0]?.id || '';
  const from = query.get('from') || daysAgoText(6);
  const to = query.get('to') || todayText();
  const device = deviceById(deviceId);
  const records = state.data.records.filter((record) => (
    record.device === deviceId && record.status === '已复核确认' && record.date >= from && record.date <= to
  ));
  const dates = [...new Set(records.map((record) => record.date))].sort();
  const evals = records.map(recordEvaluation);
  return `<div class="print-toolbar app-only"><div><strong>每周天平校验统计记录 · A4 横向预览</strong><div class="muted small">${esc(deviceId)} · ${esc(from)} ~ ${esc(to)}</div></div>
      <div class="row"><a class="btn btn-secondary" href="#/export">返回导出</a><button class="btn btn-primary" data-action="print-window">${icon('printer')}打印</button></div></div>
    <article class="print-paper week">
      <div class="print-title">每周天平校验统计记录表</div>
      <div class="print-sub">单位：${esc(device?.dept || '')} · 天平编号：${esc(deviceId)} · 周期：${esc(from)} ~ ${esc(to)}</div>
      <table class="print-grid">
        <tr><td class="label">天平唯一号</td><td>${esc(device?.uniqueNo || '')}</td><td class="label">Max / d</td><td>${esc(device?.max || '')}g / ${esc(device?.d || '')}mg</td><td class="label">参考砝码</td><td>${esc(device?.points?.join(' / ') || '')}g</td></tr>
        <tr><td class="label">统计结论</td><td colspan="${Math.max(3, dates.length * 2 + 3)}">${records.length ? `${records.filter((record) => recordEvaluation(record)?.pass).length} 次通过 / ${evals.filter((evaluation) => !evaluation?.pass).length} 次不通过` : '本日期段无已复核确认记录'}</td></tr>
        <tr><th>项目</th>${(dates.length ? dates : ['无记录']).map((date) => `<th colspan="2">${esc(date)}</th>`).join('')}</tr>
        ${[
          ['清洁', (record) => record.cleanliness],
          ['水平调节', (record) => record.level],
          ['内部校正', (record) => record.internalCal],
          ['砝码盒', (record) => record.box],
          ['备注', (record) => record.remark],
          ['外部校正', (record) => recordEvaluation(record)?.conclusion]
        ].map(([label, getter]) => `<tr><td class="label">${esc(label)}</td>${dates.length ? dates.map((date) => {
          const record = records.find((item) => item.date === date);
          return `<td colspan="2">${esc(record ? getter(record) : '')}</td>`;
        }).join('') : '<td colspan="2">—</td>'}</tr>`).join('')}
        ${[0, 1, 2].map((point) => `<tr><td class="label">L${point + 1} 示值 / 结论</td>${dates.length ? dates.map((date) => {
          const record = records.find((item) => item.date === date);
          const items = (recordEvaluation(record)?.items || []).filter((item) => item.point === point);
          return `<td colspan="2">${items.map((item) => `${formatNumber(item.value, item.dec)}${item.inLimit ? '✓' : '!'}`).join(' / ') || '—'}</td>`;
        }).join('') : '<td colspan="2">—</td>'}</tr>`).join('')}
        <tr><td class="label">校验人员</td>${dates.length ? dates.map((date) => {
          const record = records.find((item) => item.date === date);
          return `<td colspan="2">${esc(record ? accountName(record.inspector) : '')}</td>`;
        }).join('') : '<td colspan="2">—</td>'}</tr>
        <tr><td class="label">复核确认人</td>${dates.length ? dates.map((date) => {
          const record = records.find((item) => item.date === date);
          return `<td colspan="2">${esc(record ? accountName(record.verifiedBy) : '')}</td>`;
        }).join('') : '<td colspan="2">—</td>'}</tr>
      </table>
      <div class="print-note">本统计仅使用已复核确认且未作废记录。无记录日期不生成列。导出时间：${esc(currentDateTimeText())}</div>
    </article>`;
}

function pagePrintBlank() {
  const accounts = state.data.accounts.filter((account) => ['inspector', 'verifier'].includes(account.role) && account.status === '启用');
  const devices = state.data.devices.filter((device) => device.status === '在用');
  return `<div class="print-toolbar app-only"><div><strong>空白表与卡片内容清单</strong><div class="muted small">客户可自行打印并张贴固定设备卡</div></div>
      <div class="row"><a class="btn btn-secondary" href="#/export">返回导出</a><button class="btn btn-primary" data-action="print-window">${icon('printer')}打印</button></div></div>
    <article class="print-paper">
      <div class="print-title">电子天平日常校验空白记录表</div>
      <div class="print-sub">打印后与现行纸质记录并行留档</div>
      <table class="print-grid">
        <tr><td class="label">科室</td><td></td><td class="label">天平唯一号</td><td></td><td class="label">Max / d</td><td>　　　g / 　　　mg</td></tr>
        <tr><td class="label">内部校正方式</td><td>□自动　□手动　□NA</td><td class="label">校验日期</td><td></td><td class="label">砝码盒编号</td><td></td></tr>
        <tr><td class="label">清洁</td><td>□是　□否　□NA</td><td class="label">水平调节</td><td>□是　□否　□NA</td><td class="label">内部校正通过</td><td>□是　□否　□NA</td></tr>
        <tr><td class="label">备注</td><td colspan="5" style="height:36px"></td></tr>
      </table>
      <table class="print-grid" style="margin-top:8px">
        <tr><th>读数</th>${[1,2,3].map((n) => `<th>L${n}(g)</th><th>上限 / 下限</th><th>第1次</th><th>第2次</th><th>第3次</th>`).join('')}</tr>
        ${[1,2,3].map((n) => `<tr><td>L${n}</td>${[1,2,3].map(() => '<td></td><td></td><td></td><td></td><td></td>').join('')}</tr>`).join('')}
      </table>
      <div class="print-sign"><div>校验人员签名：____________　日期：____________</div><div>复核确认人签名：____________　日期：____________</div></div>
      <div class="print-note">判定依据：|I−L| ≤ 0.05%×L；九次读数全部在限内且流程完整时判为通过。</div>
      <div class="print-title" style="margin-top:24px;font-size:16px">人员卡与设备卡内容清单</div>
      <div class="blank-card-grid">
        <div><b>人员卡</b>${accounts.map((account) => `<div class="qr-box">${esc(account.id)} · ${esc(account.name)} · ${esc(roleLabel(account.role))}</div>`).join('')}</div>
        <div><b>设备卡</b>${devices.map((device) => `<div class="qr-box">${esc(device.qrContent === '天平唯一号' ? device.uniqueNo : device.id)} · ${esc(device.id)}</div>`).join('')}</div>
      </div>
      <div class="print-note">二维码内容仅包含账号编号或天平编号，不含敏感人员信息。建议尺寸不小于 40mm×40mm，纠错等级 H。</div>
    </article>`;
}

function routeAllowed(path) {
  if (path === '/upload') return isRole('inspector');
  if (path === '/verify') return isRole('verifier');
  if (['/masterdata', '/template'].includes(path)) return can('masterdata.write') || can('template.write');
  if (['/accounts', '/audit', '/system'].includes(path)) return isRole('admin');
  if (path === '/print/blank') return isRole('admin') || isRole('verifier');
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
    shell('天平历史汇总', `${deviceId} · 示值明细`, pageHistory(deviceId), { pathname: '/records' });
    return;
  }
  if (path === '/verify') {
    shell('待复核', '检查证据并完成电子签名', pageVerify(), { pathname: path });
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
    const record = recordById(decodeURIComponent(printMatch[1]));
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${record
      ? pagePrintRecord(record)
      : '<section class="card"><div class="empty"><strong>未找到记录</strong><a href="#/records">返回记录列表</a></div></section>'}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/week') {
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintWeek()}</div></main>`;
    wireDynamic();
    return;
  }
  if (path === '/print/blank') {
    root.innerHTML = `<main class="main" style="margin-left:0"><div class="content">${pagePrintBlank()}</div></main>`;
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

async function downloadFromApi(path, body, fallbackName) {
  const response = await fetchResponse(path, {
    method: 'POST',
    body: body || {}
  });
  const blob = await response.blob();
  triggerDownload(blob, fileNameFromResponse(response, fallbackName));
  return blob.size;
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
      <div class="field"><label class="required">科室</label><input name="dept" value="${attr(value.dept)}" required></div>
      <div class="field"><label class="required">量程数量</label><select name="ranges" id="device-ranges">
        <option value="1" ${value.ranges !== 2 ? 'selected' : ''}>单量程</option>
        <option value="2" ${value.ranges === 2 ? 'selected' : ''}>双量程</option>
      </select></div>
      <div class="field"><label class="required">第一量程 Max(g)</label><input name="range1Max" type="number" step="0.0001" min="0.0001" value="${attr(value.range1?.max || 220)}" required></div>
      <div class="field"><label class="required">第一量程 d(mg)</label><input name="range1D" type="number" step="0.0001" min="0.0001" value="${attr(value.range1?.d || 0.1)}" required></div>
      <div class="field" id="range2-max-field"><label>第二量程 Max(g)</label><input name="range2Max" type="number" step="0.0001" value="${attr(value.range2?.max ?? '')}"></div>
      <div class="field" id="range2-d-field"><label>第二量程 d(mg)</label><input name="range2D" type="number" step="0.0001" value="${attr(value.range2?.d ?? '')}"></div>
      <div class="field"><label class="required">内部校正方式</label><select name="internalCal">
        ${['自动触发', '手动触发', 'NA'].map((option) => `<option ${value.internalCal === option ? 'selected' : ''}>${option}</option>`).join('')}
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

function showAccountModal(account = null) {
  const editing = Boolean(account);
  openModal({
    title: editing ? `编辑账号 ${account.id}` : '新增账号',
    subtitle: '一个账号只能承担一种角色；账号编号同时作为人员二维码内容',
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
          return `<tr><td><b class="mono">I${point + 1}-${idx}</b></td>
            <td><input name="value_${point}_${idx}" type="number" step="any"></td>
            <td><input name="time_${point}_${idx}" type="datetime-local" value="${attr(String(task.startTime || currentDateTimeInput()).replace(' ', 'T').slice(0,16))}"></td>
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
          readouts.push({
            point,
            idx,
            value: value === '' ? null : Number(value),
            unit: 'g',
            off: 30 + (point * 3 + idx - 1) * 35,
            conf: value === '' ? 0 : 1,
            stable: form.querySelector(`[name="stable_${point}_${idx}"]`)?.checked !== false,
            time: String(data[`time_${point}_${idx}`] || '').replace('T', ' '),
            range: device.ranges === 2 && point > 0 ? 2 : 1
          });
        }
      }
      await api(`/api/tasks/${encodeURIComponent(task.id)}/manual-complete`, {
        method: 'POST',
        body: {
          deviceId: device.id,
          durationSeconds: data.durationSeconds ? Number(data.durationSeconds) : null,
          rangeSwitch: form.querySelector('[name="rangeSwitch"]')?.checked !== false,
          readouts,
          speech: {
            cleanliness: { value: data.cleanliness, conf: 1 },
            level: { value: data.level, conf: 1 },
            internalCal: { value: data.internalCal, conf: 1 }
          }
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
    render();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function startUpload() {
  const up = state.upload;
  if (up.busy || !up.file) return;
  if (!up.confirmed) {
    toast('请先确认拍摄开始时间', 'warn');
    return;
  }
  const startedAt = String(up.startedAt || '').replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startedAt)) {
    toast('请填写完整的拍摄开始时间', 'error');
    return;
  }
  up.busy = true;
  up.abortController = new AbortController();
  up.status = '正在初始化上传';
  up.message = '';
  up.completedTaskId = '';
  render();
  try {
    const initialized = await api('/api/uploads/init', {
      method: 'POST',
      body: {
        fileName: up.file.name,
        sizeBytes: up.file.size,
        startedAt
      },
      signal: up.abortController.signal
    });
    up.uploadId = initialized.uploadId;
    up.offset = Number(initialized.receivedBytes || 0);
    up.progress = up.file.size ? up.offset / up.file.size * 100 : 0;
    up.status = up.offset ? '从服务器断点继续上传' : '正在上传';
    render();
    await uploadRemainingChunks();
  } catch (error) {
    if (error.name === 'AbortError') {
      up.status = '上传已取消';
      up.message = '已中止本次上传。若服务端已接收部分分片，可使用同一会话继续。';
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
  toast('视频上传完成，已创建分析任务', 'success');
  await loadState({ renderAfter: false });
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
    reason: `记录核对页修改${field === 'box' ? '砝码盒编号' : '口述确认项'}`
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
    case 'fill-account': {
      const account = document.getElementById('login-account');
      const password = document.getElementById('login-password');
      if (account) account.value = element.dataset.account || '';
      if (password) password.focus();
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
      state.upload.file = null;
      state.upload.uploadId = null;
      state.upload.offset = 0;
      state.upload.progress = 0;
      state.upload.status = '';
      state.upload.message = '';
      state.upload.completedTaskId = '';
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
    case 'export-records-csv':
      await withBusy(element, async () => {
        const records = filterRecords(state.data.records);
        const devices = [...new Set(records.map((record) => record.device))];
        await downloadFromApi('/api/exports/csv', {
          type: 'records',
          devices,
          from: state.filters.records.from || undefined,
          to: state.filters.records.to || undefined
        }, '天平校验记录清单.csv');
        toast('记录清单 CSV 已开始下载', 'success');
      });
      return;
    case 'history-csv':
      await withBusy(element, async () => {
        await downloadFromApi('/api/exports/csv', {
          type: 'readouts',
          devices: [element.dataset.device]
        }, `天平校验示值明细_${element.dataset.device}.csv`);
        toast('示值明细 CSV 已开始下载', 'success');
      });
      return;
    case 'master-tab':
      state.ui.masterTab = element.dataset.tab === 'boxes' ? 'boxes' : 'devices';
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
    case 'reset-record-filter':
      state.filters.records = { device: '', from: '', to: '', inspector: '', status: '', conclusion: '' };
      if (parseRoute().query.get('draft') === '1') navigate('/records?draft=1');
      else render();
      return;
    case 'reset-verify-filter':
      state.filters.verify = { device: '', from: '', to: '', inspector: '' };
      render();
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
    case 'print-window':
      window.print();
      return;
    default:
      return;
  }
}

async function handleForm(form) {
  const type = form.dataset.form;
  if (type === 'login') {
    const submit = form.querySelector('[data-submit-label]');
    await withBusy(submit, async () => {
      const data = formObject(form);
      if (!data.account?.trim() || !data.password) throw new ClientError('请输入账号与口令');
      try {
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: { account: data.account.trim(), password: data.password },
          allowUnauthorized: true
        });
        state.session = result.user;
        state.csrfToken = result.csrfToken || '';
        if (result.user.mustChangePassword) {
          renderChangePassword();
          return;
        }
        await loadState({ renderAfter: false });
        navigate('/dashboard');
        toast(`登录成功：${result.user.name}`, 'success');
      } catch (error) {
        renderLogin(errorMessage(error));
      }
    });
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
      window.location.hash = '#/dashboard';
      render();
      toast('口令修改成功，已进入系统', 'success');
    }).catch((error) => {
      if (errorBox) errorBox.innerHTML = `<div class="alert danger mt12">${esc(errorMessage(error))}</div>`;
    });
    return;
  }
  if (type === 'record-filter') {
    state.filters.records = {
      ...state.filters.records,
      ...formObject(form)
    };
    render();
    return;
  }
  if (type === 'verify-filter') {
    state.filters.verify = {
      ...state.filters.verify,
      ...formObject(form)
    };
    render();
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
            printTime: form.querySelector('[name="printTime"]')?.checked === true,
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
      await downloadFromApi('/api/exports/records', {
        devices,
        from: data.from,
        to: data.to,
        includeUnverified: form.querySelector('[name="includeUnverified"]')?.checked === true
      }, `天平校验记录_${devices.join('-')}_${data.from.replaceAll('-', '')}-${data.to.replaceAll('-', '')}.pdf`);
      toast('批量 PDF 已生成并开始下载', 'success');
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
        from: data.from,
        to: data.to
      }, `天平校验周统计_${data.device}_${data.from.replaceAll('-', '')}-${data.to.replaceAll('-', '')}.pdf`);
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
  if (target.id === 'video-file') {
    chooseVideoFile(target.files?.[0]);
    return;
  }
  if (target.id === 'upload-start') {
    state.upload.startedAt = target.value;
    return;
  }
  if (target.name === 'timeConfirmed') {
    state.upload.confirmed = target.checked;
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.children.length) closeModal();
});

window.addEventListener('hashchange', () => {
  if (!state.data?.user) {
    if (state.session?.mustChangePassword) renderChangePassword();
    else renderLogin();
    return;
  }
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
