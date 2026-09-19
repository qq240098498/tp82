// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  summaryRows: [],
  detailName: '',
  detail: null,
  previewPlan: null,
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
    await refreshAll();
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
    await refreshAll();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 项目或登记发生变动后，三个区连同已展开的明细一起刷新
async function refreshAll() {
  await loadProjects();
  await loadDeps();
  await loadConsistency();
  if (state.detailName) {
    try {
      await openDetail(state.detailName);
    } catch (err) {
      closeDetail();
    }
  }
}

// ===== 版本对照：按依赖汇总、下钻明细、统一版本（预演 + 执行）=====

async function loadConsistency() {
  const params = new URLSearchParams();
  const keyword = el('consistency-keyword').value.trim();
  if (keyword) params.set('keyword', keyword);
  if (el('consistency-only-diff').checked) params.set('onlyInconsistent', '1');
  const query = params.toString();
  const payload = await request(`/api/consistency${query ? `?${query}` : ''}`);
  state.summaryRows = payload.rows || [];
  renderConsistency();
}

function renderConsistency() {
  const body = el('consistency-body');
  body.innerHTML = state.summaryRows.map((row) => {
    const open = state.detailName && state.detailName.toLowerCase() === row.name.toLowerCase();
    const chain = row.versions.map((item, index) => {
      const picked = item.version === row.recommendation.version;
      const projects = item.projects.map((project) => project.name).join('、');
      const chip = `<span class="ver-chip${picked ? ' pick' : ''}" title="使用项目：${escapeHtml(projects)}">`
        + `${escapeHtml(item.version)}<em>×${item.count}</em></span>`;
      if (index === row.versions.length - 1) return chip;
      return `${chip}<span class="ver-arrow" title="${escapeHtml(item.gapToNext)}">→</span>`;
    }).join('');
    const range = row.consistent ? '' : `<div class="ver-range">${escapeHtml(row.lowestVersion)} → ${escapeHtml(row.highestVersion)}：${escapeHtml(row.rangeGap)}</div>`;
    const verdict = row.consistent
      ? '<span class="tag ok">版本一致</span>'
      : `<span class="tag bad">版本不一致 · ${row.versions.length} 个版本</span>`;
    return `<tr>
      <td class="mono">${escapeHtml(row.name)}</td>
      <td>${row.projectCount} 个项目<br><span class="sub-text">${row.entryCount} 条登记</span></td>
      <td><div class="ver-chain">${chain}</div>${range}</td>
      <td>${verdict}</td>
      <td><span class="pick-ver">${escapeHtml(row.recommendation.version)}</span>
        <div class="pick-reason">${escapeHtml(row.recommendation.reason)}</div></td>
      <td class="actions">
        <button type="button" class="link" data-consistency-detail="${escapeHtml(row.name)}">${open ? '收起明细' : '查看明细'}</button>
      </td>
    </tr>`;
  }).join('');
  el('consistency-empty').classList.toggle('hidden', state.summaryRows.length > 0);
  const inconsistent = state.summaryRows.filter((row) => !row.consistent).length;
  el('consistency-summary').textContent = `共 ${state.summaryRows.length} 条依赖，其中 ${inconsistent} 条在不同项目间版本不一致（已排在最前面）`;
}

async function openDetail(name) {
  const detail = await request(`/api/consistency/${encodeURIComponent(name)}`);
  state.detailName = detail.name;
  state.detail = detail;
  el('consistency-detail').classList.remove('hidden');
  el('unify-result').classList.add('hidden');
  renderDetail();
  renderConsistency();
}

function closeDetail() {
  state.detailName = '';
  state.detail = null;
  state.previewPlan = null;
  el('consistency-detail').classList.add('hidden');
  renderConsistency();
}

function renderDetail() {
  const detail = state.detail;
  el('detail-title').textContent = `${detail.name}：各项目登记明细`;

  const chain = detail.versions.map((item, index) => {
    const tail = index === detail.versions.length - 1
      ? ''
      : `<div class="reason-gap">${escapeHtml(item.version)} → ${escapeHtml(detail.versions[index + 1].version)}：${escapeHtml(item.gapToNext)}</div>`;
    return tail;
  }).join('');
  el('detail-reason').innerHTML = `共 ${detail.projectCount} 个项目使用、${detail.entryCount} 条登记。`
    + (detail.consistent
      ? '所有登记版本一致，不需要统一。'
      : `<div class="reason-line">版本从低到高：${detail.versions.map((item) => escapeHtml(item.version)).join(' → ')}，最低 ${escapeHtml(detail.lowestVersion)} 与最高 ${escapeHtml(detail.highestVersion)} 之间${escapeHtml(detail.rangeGap)}</div>${chain}`
        + `<div class="reason-pick">推荐统一到 <strong>${escapeHtml(detail.recommendation.version)}</strong>：${escapeHtml(detail.recommendation.reason)}</div>`);

  const target = el('unify-target');
  target.innerHTML = detail.versions
    .map((item) => `<option value="${escapeHtml(item.version)}">${escapeHtml(item.version)}（${item.count} 个项目在用）</option>`)
    .join('');
  target.value = detail.recommendation.version;
  el('unify-bar').classList.toggle('hidden', detail.consistent);

  el('detail-body').innerHTML = detail.records.map((record) => {
    const statusTag = record.status === '已弃用' ? 'off' : 'on';
    return `<tr data-detail-version="${escapeHtml(record.version)}">
      <td>${escapeHtml(record.projectName)}</td>
      <td class="mono dep-id">${escapeHtml(record.depId)}</td>
      <td class="mono">${escapeHtml(record.version)}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(record.status)}</span></td>
      <td>${record.license ? escapeHtml(record.license) : '<span class="missing">未填</span>'}</td>
      <td>${record.owner ? escapeHtml(record.owner) : '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(record.note)}</td>
      <td class="mono">${escapeHtml(formatTime(record.updatedAt))}</td>
    </tr>`;
  }).join('');
  paintDetailChangeMarks();
}

// 目标版本换了之后，明细表上把将要被改动的登记先标出来，和预演弹层保持一致
function paintDetailChangeMarks() {
  if (!state.detail) return;
  const target = el('unify-target').value;
  el('detail-body').querySelectorAll('tr').forEach((row) => {
    const different = row.dataset.detailVersion !== target;
    row.classList.toggle('will-change', different && !state.detail.consistent);
    let mark = row.querySelector('.change-mark');
    if (different && !state.detail.consistent) {
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'change-mark';
        row.cells[2].appendChild(mark);
      }
      mark.textContent = '将改动';
    } else if (mark) {
      mark.remove();
    }
  });
  const selected = state.detail.versions.find((item) => item.version === target);
  el('unify-hint').textContent = selected
    ? `目标版本 ${target}，已有 ${selected.count} 条登记在用，其余登记将被修改`
    : '';
}

function openUnifyModal(plan) {
  state.previewPlan = plan;
  el('unify-modal-desc').innerHTML = `把依赖 <strong>${escapeHtml(plan.name)}</strong> 统一到 <strong>${escapeHtml(plan.version)}</strong>：`
    + `共 <strong>${plan.changes.length}</strong> 条登记需要修改，${plan.unchangedCount} 条原本就是该版本、保持不变。`;
  el('unify-changes-body').innerHTML = plan.changes.length ? plan.changes.map((change) => `<tr>
      <td>${escapeHtml(change.projectName)}</td>
      <td class="mono dep-id">${escapeHtml(change.depId)}</td>
      <td class="mono">${escapeHtml(change.fromVersion)}</td>
      <td class="mono">${escapeHtml(change.toVersion)}</td>
      <td>${escapeHtml(change.relation.text)}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="missing">所有登记都已经是这个版本，没有需要改动的条目</td></tr>';
  el('unify-confirm-btn').classList.toggle('hidden', plan.changes.length === 0);
  el('unify-modal').classList.remove('hidden');
}

function closeUnifyModal() {
  state.previewPlan = null;
  el('unify-modal').classList.add('hidden');
}

async function previewUnify() {
  if (!state.detail) return;
  clearNotice();
  try {
    const plan = await request('/api/consistency/preview', {
      method: 'POST',
      body: JSON.stringify({ name: state.detail.name, version: el('unify-target').value }),
    });
    openUnifyModal(plan);
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function confirmUnify() {
  const plan = state.previewPlan;
  if (!plan) return;
  const button = el('unify-confirm-btn');
  button.disabled = true;
  try {
    const result = await request('/api/consistency/unify', {
      method: 'POST',
      body: JSON.stringify({ name: plan.name, version: plan.version, confirmed: true }),
    });
    closeUnifyModal();
    await loadProjects();
    await loadDeps();
    await loadConsistency();
    await openDetail(result.name);
    renderUnifyResult(result);
    notify(`已把 ${result.name} 统一到 ${result.version}，共修改 ${result.changedCount} 条登记`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// 统一完成后的回执：这次改了哪些项目、从什么版本改成了什么版本
function renderUnifyResult(result) {
  const box = el('unify-result');
  const projectCount = new Set(result.changed.map((change) => change.projectId)).size;
  const rows = result.changed.map((change) => `<tr>
      <td>${escapeHtml(change.projectName)}</td>
      <td class="mono">${escapeHtml(change.fromVersion)}</td>
      <td class="mono">${escapeHtml(change.toVersion)}</td>
      <td>${escapeHtml(change.relation.text)}</td>
    </tr>`).join('');
  box.innerHTML = `<div class="unify-result-head">✔ 已统一到 ${escapeHtml(result.version)}：本次改动涉及 ${projectCount} 个项目、共 ${result.changedCount} 条登记，另有 ${result.unchangedCount} 条原本就是该版本</div>
    <table class="grid compact">
      <thead><tr><th>项目</th><th>原版本</th><th>改成</th><th>版本关系</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sub-text">执行时间：${escapeHtml(formatTime(result.changedAt))}</div>`;
  box.classList.remove('hidden');
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
      await refreshAll();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.consistencyDetail !== undefined) {
    clearNotice();
    const name = node.dataset.consistencyDetail;
    if (state.detailName && state.detailName.toLowerCase() === name.toLowerCase()) {
      closeDetail();
    } else {
      openDetail(name).catch((err) => notify(err.message, 'error'));
    }
    return;
  }

  if (node.id === 'detail-close') {
    closeDetail();
    return;
  }

  if (node.id === 'unify-preview-btn') {
    previewUnify();
    return;
  }

  if (node.id === 'unify-confirm-btn') {
    confirmUnify();
    return;
  }

  if (node.id === 'unify-cancel-btn') {
    closeUnifyModal();
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
      await refreshAll();
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

el('consistency-apply').addEventListener('click', () => {
  clearNotice();
  loadConsistency().catch((err) => notify(err.message, 'error'));
});
el('consistency-keyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadConsistency().catch((err) => notify(err.message, 'error'));
  }
});
el('consistency-only-diff').addEventListener('change', () => {
  loadConsistency().catch((err) => notify(err.message, 'error'));
});
el('consistency-refresh').addEventListener('click', () => {
  clearNotice();
  loadConsistency().catch((err) => notify(err.message, 'error'));
});
el('unify-target').addEventListener('change', paintDetailChangeMarks);
el('unify-modal').addEventListener('click', (event) => {
  if (event.target === el('unify-modal')) closeUnifyModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el('unify-modal').classList.contains('hidden')) closeUnifyModal();
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .then(loadConsistency)
  .catch((err) => notify(err.message, 'error'));
