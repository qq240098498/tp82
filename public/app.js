// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  versionItems: [],
  versionTotals: { dependencyCount: 0, inconsistentCount: 0, projectCount: 0 },
  // 弹层上下文：当前下钻的依赖名、选中的目标版本、所处阶段与最近一次预演结果
  modal: { name: '', detail: null, targetVersion: '', preview: null, stage: 'detail' },
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：项目区与依赖区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'dep-ledger-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadProjects() {
  const payload = await request('/api/projects');
  state.projects = payload.projects || [];
  renderProjects();
  renderProjectOptions();
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (license) params.set('license', license);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/deps${query ? `?${query}` : ''}`);
  state.deps = payload.deps || [];
  state.licenses = payload.licenses || [];
  state.statuses = payload.statuses || [];
  renderDepFilterOptions();
  renderDeps();
  // 登记有任何增删改后都会走这里，顺手把版本对照也刷新
  loadVersions();
}

function renderProjects() {
  const body = el('project-body');
  body.innerHTML = state.projects.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.owner) || '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${item.depCount} 条</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-project-rename="${escapeHtml(item.id)}">改名</button>
        <button type="button" class="link" data-project-owner="${escapeHtml(item.id)}">改负责人</button>
        <button type="button" class="link danger" data-project-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('project-empty').classList.toggle('hidden', state.projects.length > 0);
}

function renderProjectOptions() {
  const select = el('dep-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  if (state.projects.some((item) => item.id === current)) select.value = current;

  const filter = el('filter-project');
  const filterCurrent = filter.value;
  filter.innerHTML = '<option value="">全部项目</option>'
    + state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.projects.some((item) => item.id === filterCurrent)) filter.value = filterCurrent;
}

function renderDepFilterOptions() {
  const statusSelect = el('filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const licenseSelect = el('filter-license');
  const licenseCurrent = licenseSelect.value;
  licenseSelect.innerHTML = '<option value="">全部许可</option>'
    + state.licenses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.licenses.includes(licenseCurrent)) licenseSelect.value = licenseCurrent;

  const statusForm = el('dep-status');
  const statusFormCurrent = statusForm.value;
  statusForm.innerHTML = state.statuses
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join('');
  if (state.statuses.includes(statusFormCurrent)) statusForm.value = statusFormCurrent;
}

function projectName(projectId) {
  const found = state.projects.find((item) => item.id === projectId);
  return found ? found.name : projectId;
}

function renderDeps() {
  const body = el('dep-body');
  body.innerHTML = state.deps.map((item) => {
    const statusTag = item.status === '已弃用' ? 'off' : 'on';
    return `<tr>
      <td>${escapeHtml(projectName(item.projectId))}</td>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(item.version)}</td>
      <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-dep-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-dep-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('dep-empty').classList.toggle('hidden', state.deps.length > 0);
}

// ============ 版本对照：汇总、下钻、统一预演与执行 ============

async function loadVersions() {
  const params = new URLSearchParams();
  if (el('version-only-diff').checked) params.set('onlyInconsistent', 'true');
  const keyword = el('version-keyword').value.trim();
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  let failed = false;
  try {
    const payload = await request(`/api/versions${query ? `?${query}` : ''}`);
    state.versionItems = payload.versions || [];
    state.versionTotals = payload.totals || state.versionTotals;
  } catch (err) {
    failed = true;
    state.versionItems = [];
    el('version-summary').textContent = `汇总失败：${err.message}`;
  }
  renderVersions(failed);
}

function renderVersions(loadFailed) {
  if (loadFailed) {
    el('version-body').innerHTML = '';
    el('version-empty').classList.add('hidden');
    return;
  }
  const totals = state.versionTotals;
  el('version-summary').textContent = `共 ${totals.dependencyCount} 种依赖、${totals.projectCount} 个项目；其中 ${totals.inconsistentCount} 种依赖在项目间版本不一致`
    + (el('version-only-diff').checked ? '（当前只列不一致的）' : '');

  const body = el('version-body');
  body.innerHTML = state.versionItems.map((item) => {
    const dist = item.versions.map((v) => {
      const picked = item.recommendation && item.recommendation.version === v.version;
      return `<span class="ver-chip${picked ? ' picked' : ''}" title="${picked ? '建议统一到这个版本' : ''}">${escapeHtml(v.version)}<b>×${v.count}</b>${picked ? ' ★' : ''}</span>`;
    }).join(' ');
    const status = item.consistent
      ? '<span class="tag off">一致</span>'
      : '<span class="tag warn">不一致</span>';
    const advice = item.consistent
      ? '<span class="missing">无需统一</span>'
      : `<div class="advice"><span class="mono">${escapeHtml(item.recommendation.version)}</span><span>${escapeHtml(item.recommendation.reason)}</span></div>`;
    return `<tr>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td>${item.projectCount} 个（${item.distinctVersionCount} 个版本）</td>
      <td>${dist}</td>
      <td>${status}</td>
      <td>${advice}</td>
      <td class="actions">
        <button type="button" class="link" data-version-detail="${escapeHtml(item.name)}">${item.consistent ? '查看明细' : '下钻 / 统一'}</button>
      </td>
    </tr>`;
  }).join('');
  el('version-empty').classList.toggle('hidden', state.versionItems.length > 0);
}

function openModal() {
  el('modal-mask').classList.remove('hidden');
}

function closeModal() {
  el('modal-mask').classList.add('hidden');
  state.modal = { name: '', detail: null, targetVersion: '', preview: null, stage: 'detail' };
}

function setModalBody(html) {
  el('modal-body').innerHTML = html;
}

function modalError(message) {
  const box = el('modal-error');
  if (box) {
    box.textContent = message;
    box.classList.remove('hidden');
  }
}

// 下钻：列出该依赖在每个项目里的具体登记、版本高低关系与推荐依据
async function openVersionDetail(name) {
  state.modal = { name, detail: null, targetVersion: '', preview: null, stage: 'detail' };
  el('modal-title').textContent = `版本对照明细：${name}`;
  openModal();
  setModalBody('<p class="empty-tip">正在读取登记明细…</p>');
  try {
    const detail = await request(`/api/versions/detail?name=${encodeURIComponent(name)}`);
    state.modal.detail = detail;
    state.modal.targetVersion = detail.recommendation.version;
    renderDetailView();
  } catch (err) {    setModalBody(`<p class="empty-tip">读取失败：${escapeHtml(err.message)}</p>`);
  }
}

// 版本从低到高的关系，相邻版本之间差在第几段数字一并列出来
function versionOrderHtml(detail) {
  const chain = detail.order.map((step) => {
    const arrow = step.gapFromPrevious
      ? `<span class="gap-hint" title="${escapeHtml(step.gapFromPrevious.segmentLabel)}：${escapeHtml(step.gapFromPrevious.detail)}">▲ 差在${escapeHtml(step.gapFromPrevious.segmentLabel.replace(/（.*）/, ''))}</span>`
      : '<span class="gap-hint">最低</span>';
    return `<div class="order-step">
        <span class="mono">${escapeHtml(step.version)}</span>
        ${arrow}
      </div>`;
  }).join('<div class="order-connect">↑</div>');
  const gaps = detail.order
    .filter((step) => step.gapFromPrevious)
    .map((step) => `<li><span class="mono">${escapeHtml(step.gapFromPrevious.from)}</span> → <span class="mono">${escapeHtml(step.gapFromPrevious.to)}</span>：${escapeHtml(step.gapFromPrevious.detail)}</li>`)
    .join('');
  return `<div class="detail-block">
      <h4>版本高低关系</h4>
      <div class="order-chain">${chain}</div>
      <ul class="gap-list">${gaps}</ul>
      <div class="basis-line">最高版本为 <span class="mono">${escapeHtml(detail.highestVersion)}</span>；
        推荐 <span class="mono strong">${escapeHtml(detail.recommendation.version)}</span> 的依据：${escapeHtml(detail.recommendation.reason)}</div>
    </div>`;
}

function entriesTableHtml(entries, highlightVersion) {
  const rows = entries.map((entry) => {
    const different = highlightVersion && entry.version !== highlightVersion;
    return `<tr${different ? ' class="row-diff"' : ''}>
      <td>${escapeHtml(entry.projectName)}</td>
      <td class="mono">${escapeHtml(entry.version)}${different ? ' <span class="tag warn">待改</span>' : ''}</td>
      <td>${entry.license ? escapeHtml(entry.license) : '<span class="missing">未填</span>'}</td>
      <td>${entry.owner ? escapeHtml(entry.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${entry.status === '已弃用' ? 'off' : 'on'}">${escapeHtml(entry.status)}</span></td>
      <td class="note-cell">${escapeHtml(entry.note)}</td>
      <td class="mono">${escapeHtml(formatTime(entry.updatedAt))}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap">
      <table class="grid">
        <thead><tr><th>项目</th><th>登记版本</th><th>许可</th><th>责任人</th><th>状态</th><th>备注</th><th>更新时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderDetailView() {
  state.modal.stage = 'detail';
  const detail = state.modal.detail;
  const options = detail.order.map((step) => {
    const count = (detail.versions.find((v) => v.version === step.version) || {}).count || '';
    return `<option value="${escapeHtml(step.version)}"${step.version === state.modal.targetVersion ? ' selected' : ''}>${escapeHtml(step.version)}（${count} 个项目在用，第 ${step.rank} 高）</option>`;
  }).join('');

  const unifyBox = detail.consistent ? '' : `
    <div class="detail-block unify-box">
      <h4>统一版本</h4>
      <div class="unify-controls">
        <label data-field="targetVersion">统一到
          <select id="unify-target">${options}</select>
        </label>
        <button type="button" id="unify-preview-btn">预演这次统一</button>
      </div>
      <p class="panel-tip">预演只计算改动清单、不会落盘；确认执行后才会真正修改登记。</p>
    </div>`;

  setModalBody(`
    <div class="notice error hidden" id="modal-error"></div>
    <div class="detail-block">
      <h4>登记明细（${detail.entries.length} 条，分布在 ${detail.projectCount} 个项目）</h4>
      ${entriesTableHtml(detail.entries, detail.consistent ? '' : state.modal.targetVersion)}
    </div>
    ${versionOrderHtml(detail)}
    ${unifyBox}
    <div class="modal-actions">
      <button type="button" class="ghost" id="modal-back">关闭</button>
    </div>`);
}

// 预演：把要改的登记、从什么版本改成什么版本先摆出来
async function runPreview() {
  const select = el('unify-target');
  const targetVersion = select ? select.value : state.modal.targetVersion;
  state.modal.targetVersion = targetVersion;
  modalErrorClear();
  if (!targetVersion) return;
  try {
    const payload = await request('/api/versions/unify/preview', {
      method: 'POST',
      body: JSON.stringify({ name: state.modal.name, targetVersion }),
    });
    state.modal.preview = payload.preview;
    renderPreviewView();
  } catch (err) {
    modalError(err.message);
  }
}

function modalErrorClear() {
  const box = el('modal-error');
  if (box) {
    box.textContent = '';
    box.classList.add('hidden');
  }
}

function renderPreviewView() {
  state.modal.stage = 'preview';
  const preview = state.modal.preview;
  if (preview.changeCount === 0) {
    setModalBody(`
      <div class="notice ok">${escapeHtml(preview.name)} 所有登记已经都是 ${escapeHtml(preview.targetVersion)}，没有需要改的条目。</div>
      <div class="modal-actions"><button type="button" id="modal-back">返回明细</button></div>`);
    return;
  }
  const changeRows = preview.changes.map((item) => `
    <tr class="row-diff">
      <td>${escapeHtml(item.projectName)}</td>
      <td class="mono">${escapeHtml(item.fromVersion)}</td>
      <td class="change-arrow">→</td>
      <td class="mono strong">${escapeHtml(item.toVersion)}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${item.status === '已弃用' ? 'off' : 'on'}">${escapeHtml(item.status)}</span></td>
    </tr>`).join('');
  const unchangedText = preview.unchanged
    .map((item) => `${item.projectName}（${item.version}）`)
    .join('、');
  const affectedProjectCount = new Set(preview.changes.map((item) => item.projectId)).size;

  setModalBody(`
    <div class="notice error hidden" id="modal-error"></div>
    <div class="detail-block">
      <h4>预演：统一 <span class="mono">${escapeHtml(preview.name)}</span> 到 <span class="mono strong">${escapeHtml(preview.targetVersion)}</span></h4>
      <p>将有 <b>${preview.changeCount}</b> 条登记被修改，涉及 <b>${affectedProjectCount}</b> 个项目；
        其余 ${preview.unchanged.length} 条${preview.unchanged.length ? `（${escapeHtml(unchangedText)}）` : ''}保持不动。</p>
      <div class="table-wrap">
        <table class="grid">
          <thead><tr><th>项目</th><th>当前版本</th><th></th><th>改成</th><th>责任人</th><th>状态</th></tr></thead>
          <tbody>${changeRows}</tbody>
        </table>
      </div>
      <p class="panel-tip">只改版本号，许可、责任人、状态与备注都保持原样。确认后无法在页面上撤销，请核对后再执行。</p>
    </div>
    <div class="modal-actions">
      <button type="button" id="unify-confirm-btn">确认执行统一</button>
      <button type="button" class="ghost" id="modal-back">返回修改目标版本</button>
    </div>`);
}

// 执行：落盘后展示这次到底改了哪些项目、从什么版本改成什么版本
async function confirmUnify() {
  modalErrorClear();
  try {
    const payload = await request('/api/versions/unify', {
      method: 'POST',
      body: JSON.stringify({ name: state.modal.name, targetVersion: state.modal.targetVersion }),
    });
    state.modal.preview = null;
    renderResultView(payload.result);
    // 背景里的两张表同步刷新
    await loadProjects();
    await loadDeps();
  } catch (err) {
    modalError(err.message);
  }
}

function renderResultView(result) {
  state.modal.stage = 'result';
  const rows = result.changes.map((item) => `
    <tr class="row-diff">
      <td>${escapeHtml(item.projectName)}</td>
      <td class="mono">${escapeHtml(item.fromVersion)}</td>
      <td class="change-arrow">→</td>
      <td class="mono strong">${escapeHtml(item.toVersion)}</td>
    </tr>`).join('');
  setModalBody(`
    <div class="notice ok">统一完成：<span class="mono">${escapeHtml(result.name)}</span> 已全部统一到 <span class="mono">${escapeHtml(result.targetVersion)}</span>，共修改 ${result.changeCount} 条登记、${result.projectCount} 个项目。</div>
    <div class="detail-block">
      <h4>本次改动</h4>
      <div class="table-wrap">
        <table class="grid">
          <thead><tr><th>项目</th><th>改动前</th><th></th><th>改动后</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="panel-tip">执行时间：${escapeHtml(formatTime(result.changedAt))}</p>
    </div>
    <div class="modal-actions"><button type="button" id="modal-back">关闭</button></div>`);
}

function openDepForm(dep) {
  state.editingId = dep ? dep.id : '';
  el('dep-form-title').textContent = dep ? `编辑登记：${dep.name}` : '新建登记';
  if (state.projects.length) {
    el('dep-project').value = dep ? dep.projectId : state.projects[0].id;
  }
  el('dep-name').value = dep ? dep.name : '';
  el('dep-version').value = dep ? dep.version : '';
  el('dep-license').value = dep ? dep.license : '';
  el('dep-owner').value = dep ? dep.owner : currentOperator();
  el('dep-status').value = dep ? dep.status : (state.statuses[0] || '在用');
  el('dep-note').value = dep ? dep.note : '';
  el('dep-form').classList.remove('hidden');
  el('dep-name').focus();
}

function closeDepForm() {
  state.editingId = '';
  el('dep-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitProject(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('project-name').value,
    owner: el('project-owner').value,
    note: el('project-note').value,
  };
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
    el('project-name').value = '';
    el('project-owner').value = '';
    el('project-note').value = '';
    notify('项目已新增', 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitDep(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    projectId: el('dep-project').value,
    name: el('dep-name').value,
    version: el('dep-version').value,
    license: el('dep-license').value,
    owner: el('dep-owner').value,
    status: el('dep-status').value,
    note: el('dep-note').value,
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/deps/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('依赖登记已保存', 'ok');
    } else {
      await request('/api/deps', { method: 'POST', body: JSON.stringify(payload) });
      notify('依赖登记已新增', 'ok');
    }
    closeDepForm();
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  const projectId = node.dataset.projectRename || node.dataset.projectOwner || node.dataset.projectDelete;
  if (projectId) {
    clearNotice();
    const found = state.projects.find((item) => item.id === projectId);
    if (!found) return;
    try {
      if (node.dataset.projectRename) {
        const next = window.prompt(`把 ${found.name} 的名称改成`, found.name);
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify('项目名称已更新', 'ok');
      } else if (node.dataset.projectOwner) {
        const next = window.prompt(`把 ${found.name} 的负责人改成`, found.owner || '');
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ owner: next }) });
        notify('项目负责人已更新', 'ok');
      } else {
        if (!window.confirm(`确定删除项目 ${found.name} 吗？`)) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        notify('项目已删除', 'ok');
      }
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.versionDetail) {
    clearNotice();
    openVersionDetail(node.dataset.versionDetail);
    return;
  }

  if (node.id === 'unify-preview-btn') {
    runPreview();
    return;
  }

  if (node.id === 'unify-confirm-btn') {
    await confirmUnify();
    return;
  }
  if (node.id === 'modal-back') {
    // 明细/预演页返回即回到明细；结果页返回直接关弹层
    if (state.modal.stage === 'result') {
      closeModal();
    } else {
      renderDetailView();
    }
    return;
  }

  if (node.id === 'modal-close') {
    closeModal();
    return;
  }

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      notify('登记已删除', 'ok');
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('project-form').addEventListener('submit', submitProject);
el('dep-form').addEventListener('submit', submitDep);
el('dep-new').addEventListener('click', () => {
  clearNotice();
  if (!state.projects.length) {
    notify('请先登记一个项目，再登记依赖', 'error');
    return;
  }
  openDepForm(null);
});
el('dep-cancel').addEventListener('click', closeDepForm);
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-project').value = '';
  el('filter-status').value = '';
  el('filter-license').value = '';
  el('filter-keyword').value = '';
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('dep-refresh').addEventListener('click', () => {
  clearNotice();
  loadProjects()
    .then(loadDeps)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-project').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-status').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-license').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 版本对照面板：筛选条件变化与查询按钮
el('version-search').addEventListener('click', () => {
  clearNotice();
  loadVersions();
});
el('version-keyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadVersions();
  }
});
el('version-only-diff').addEventListener('change', () => loadVersions());
el('version-refresh').addEventListener('click', () => {
  clearNotice();
  loadVersions();
});

// 点遮罩空白处或按 Esc 关闭弹层，点弹层本身不关
el('modal-mask').addEventListener('click', (event) => {
  if (event.target === el('modal-mask')) closeModal();
});
// 明细页切换目标版本时，重绘一次让“待改”标记跟着新版本走
el('modal-body').addEventListener('change', (event) => {
  if (event.target.id === 'unify-target' && state.modal.stage === 'detail') {
    state.modal.targetVersion = event.target.value;
    renderDetailView();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el('modal-mask').classList.contains('hidden')) closeModal();
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
