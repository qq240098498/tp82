// 按依赖把散在各项目里的登记汇总到一起对照版本，并给出统一到某一个版本的预演与执行。
// 汇总只读取数据；统一动作一次性改完一批登记后再落盘，中间不会留下半成品。
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { validateVersion } = require('./deps');
const { compareVersions, describeRelation, describeGap } = require('./versions');

// 依赖名在不同项目里各登记各的，大小写可能写得不一样；汇总时按忽略大小写的名字归并
function groupByName(data) {
  const groups = new Map();
  data.deps.forEach((dep) => {
    const key = dep.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: dep.name, items: [] });
    groups.get(key).items.push(dep);
  });
  return groups;
}

function projectMap(data) {
  const map = new Map();
  data.projects.forEach((project) => map.set(project.id, project));
  return map;
}

function projectBrief(project) {
  return { id: project.id, name: project.name };
}

// 统计同一个依赖下各个版本分别被哪些项目使用，版本按从低到高排好
function versionBreakdown(items, projects) {
  const byVersion = new Map();
  items.forEach((dep) => {
    if (!byVersion.has(dep.version)) {
      byVersion.set(dep.version, { version: dep.version, count: 0, projects: [] });
    }
    const bucket = byVersion.get(dep.version);
    bucket.count += 1;
    const project = projects.get(dep.projectId);
    if (project && !bucket.projects.some((item) => item.id === project.id)) {
      bucket.projects.push(projectBrief(project));
    }
  });
  const versions = Array.from(byVersion.values());
  versions.sort((a, b) => compareVersions(a.version, b.version));
  versions.forEach((bucket, index) => {
    bucket.projects.sort((a, b) => (a.name < b.name ? -1 : 1));
    if (index < versions.length - 1) {
      bucket.gapToNext = describeGap(bucket.version, versions[index + 1].version);
    } else {
      bucket.gapToNext = '';
    }
  });
  return versions;
}

// 多数派推荐：使用项目最多的版本视为最稳妥；并列时按就高原则取版本高的那个
function pickRecommendation(versions, projectCount) {
  const topCount = versions.reduce((max, item) => Math.max(max, item.count), 0);
  const leaders = versions.filter((item) => item.count === topCount);
  // versions 已按从低到高排好，并列时取最后一个就是版本最高的
  const winner = leaders[leaders.length - 1];
  let reason;
  if (versions.length === 1) {
    reason = `全部 ${projectCount} 个项目都在用 ${winner.version}，版本本来就一致`;
  } else if (leaders.length === 1) {
    reason = `${winner.version} 被 ${winner.count} 个项目使用（共 ${projectCount} 个项目在用这个依赖），使用项目最多，统一到它影响面最小、最稳妥`;
  } else {
    const tied = leaders.map((item) => item.version).join('、');
    reason = `${tied} 使用项目数并列最多（各 ${topCount} 个），其中 ${winner.version} 版本最高，按就高原则推荐统一到它`;
  }
  return {
    version: winner.version,
    count: winner.count,
    tied: leaders.length > 1,
    reason,
  };
}

// 一条依赖的汇总行：项目数、登记条数、版本分布、高低跨度与推荐版本
function buildRow(group, projects) {
  const items = group.items.slice().sort((a, b) => {
    const nameA = projects.get(a.projectId)?.name || a.projectId;
    const nameB = projects.get(b.projectId)?.name || b.projectId;
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const projectIds = new Set(items.map((dep) => dep.projectId));
  const versions = versionBreakdown(items, projects);
  const lowest = versions[0];
  const highest = versions[versions.length - 1];
  const consistent = versions.length === 1;
  return {
    name: group.name,
    projectCount: projectIds.size,
    entryCount: items.length,
    consistent,
    versions,
    lowestVersion: lowest.version,
    highestVersion: highest.version,
    // 最低与最高版本之间差在第几段数字，直接说明分歧有多大
    rangeGap: consistent ? '' : describeGap(lowest.version, highest.version),
    recommendation: pickRecommendation(versions, projectIds.size),
  };
}

function listSummary(options) {
  const input = options && typeof options === 'object' ? options : {};
  const keyword = pickText(input.keyword).toLowerCase();
  const onlyInconsistent = input.onlyInconsistent === true || pickText(input.onlyInconsistent) === '1' || pickText(input.onlyInconsistent) === 'true';
  const data = load();
  const projects = projectMap(data);
  let rows = Array.from(groupByName(data).values()).map((group) => buildRow(group, projects));
  if (keyword) rows = rows.filter((row) => row.name.toLowerCase().includes(keyword));
  if (onlyInconsistent) rows = rows.filter((row) => !row.consistent);
  rows.sort((a, b) => {
    if (a.consistent !== b.consistent) return a.consistent ? 1 : -1;
    if (a.projectCount !== b.projectCount) return b.projectCount - a.projectCount;
    return a.name < b.name ? -1 : 1;
  });
  return {
    rows,
    total: rows.length,
    inconsistentCount: rows.filter((row) => !row.consistent).length,
  };
}

function findGroup(data, name) {
  const value = pickText(name);
  if (!value) throw new ApiError(400, 'CONSISTENCY_NAME_REQUIRED', '请指定要对照的依赖名称', 'name');
  const group = groupByName(data).get(value.toLowerCase());
  if (!group) throw new ApiError(404, 'CONSISTENCY_DEP_NOT_FOUND', `没有任何项目登记过 ${value}`, 'name');
  return group;
}

// 下钻：列出这条依赖在每个项目里的具体登记条目
function getDetail(name) {
  const data = load();
  const projects = projectMap(data);
  const group = findGroup(data, name);
  const row = buildRow(group, projects);
  const records = group.items
    .map((dep) => {
      const project = projects.get(dep.projectId);
      return {
        depId: dep.id,
        projectId: dep.projectId,
        projectName: project ? project.name : dep.projectId,
        version: dep.version,
        status: dep.status,
        license: dep.license,
        owner: dep.owner,
        note: dep.note,
        updatedAt: dep.updatedAt,
      };
    })
    .sort((a, b) => {
      const cmp = compareVersions(a.version, b.version);
      if (cmp !== 0) return cmp;
      return a.projectName < b.projectName ? -1 : 1;
    });
  return { ...row, records };
}

// 预演与执行共用的一份改动清单：版本不同的登记才需要动，并逐条说清高低关系
function planUnify(data, name, targetVersion) {
  const projects = projectMap(data);
  const group = findGroup(data, name);
  const version = validateVersion(targetVersion);
  const changes = [];
  group.items.forEach((dep) => {
    if (dep.version === version) return;
    const project = projects.get(dep.projectId);
    changes.push({
      depId: dep.id,
      projectId: dep.projectId,
      projectName: project ? project.name : dep.projectId,
      fromVersion: dep.version,
      toVersion: version,
      relation: describeRelation(dep.version, version),
      status: dep.status,
      owner: dep.owner,
    });
  });
  changes.sort((a, b) => {
    const cmp = compareVersions(a.fromVersion, b.fromVersion);
    if (cmp !== 0) return cmp;
    return a.projectName < b.projectName ? -1 : 1;
  });
  return {
    name: group.name,
    version,
    changes,
    unchangedCount: group.items.length - changes.length,
    entryCount: group.items.length,
  };
}

function previewUnify(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const plan = planUnify(data, input.name, input.version);
  return {
    ...plan,
    needConfirm: plan.changes.length > 0,
    message: plan.changes.length === 0 ? '所有登记都已经是这个版本，不需要改动' : '',
  };
}

function executeUnify(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  if (input.confirmed !== true) {
    throw new ApiError(400, 'UNIFY_CONFIRM_REQUIRED', '请先在页面上看过预演并确认，再执行统一', 'confirmed');
  }
  const data = load();
  const plan = planUnify(data, input.name, input.version);
  if (plan.changes.length === 0) {
    throw new ApiError(409, 'UNIFY_NO_CHANGE', '所有登记都已经是这个版本，没有需要改动的条目', 'version');
  }

  const changedAt = new Date().toISOString();
  const changeById = new Map(plan.changes.map((item) => [item.depId, item]));
  data.deps.forEach((dep) => {
    const change = changeById.get(dep.id);
    if (!change) return;
    dep.version = plan.version;
    dep.updatedAt = changedAt;
  });
  save(data);

  return {
    name: plan.name,
    version: plan.version,
    changedAt,
    changedCount: plan.changes.length,
    unchangedCount: plan.unchangedCount,
    changed: plan.changes,
  };
}

module.exports = {
  listSummary,
  getDetail,
  previewUnify,
  executeUnify,
};
