// 按依赖名汇总各项目的登记：版本分布、是否一致、推荐统一版本与依据，
// 以及统一到某个版本的预演与执行。预演只算不写，执行才真正改登记。
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { validateVersion } = require('./deps');

const SEGMENT_LABELS = ['主版本号（第一段）', '次版本号（第二段）', '修订号（第三段）'];
const SEGMENT_NAMES = ['major', 'minor', 'patch'];

// 把版本拆成可比较的结构：三段数字 + 可选预发布后缀
function parseVersion(version) {
  const text = pickText(version);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(text);
  if (!match) return null;
  return {
    version: text,
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? null : match[4],
  };
}

// 语义版本先后比较：先比三段数字，数字相同则正式版排在预发布版之后（正式版更稳）
function compareParsed(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
}

// 列出版本之间的高低关系：从低到高排好，标出相邻版本差在第几段数字上
function describeOrder(versions) {
  const parsed = versions
    .map((value) => parseVersion(value.version))
    .filter(Boolean)
    .sort(compareParsed);
  const ordered = [];
  for (let i = 0; i < parsed.length; i += 1) {
    let diffSegment = -1;
    let gap = null;
    if (i > 0) {
      const prev = parsed[i - 1];
      for (let s = 0; s < 3; s += 1) {
        if (prev.core[s] !== parsed[i].core[s]) {
          diffSegment = s;
          break;
        }
      }
      // 三段数字完全相同只差预发布后缀时，单列成预发布差异
      if (diffSegment === -1) {
        diffSegment = 2;
      }
      gap = {
        from: prev.version,
        to: parsed[i].version,
        segment: diffSegment,
        segmentName: SEGMENT_NAMES[diffSegment],
        segmentLabel: diffSegment === 2 && coresEqual(prev, parsed[i])
          ? '预发布后缀'
          : SEGMENT_LABELS[diffSegment],
        prereleaseOnly: coresEqual(prev, parsed[i]),
        detail: describeGap(prev, parsed[i], diffSegment),
      };
    }
    ordered.push({
      version: parsed[i].version,
      rank: i + 1,
      higherThan: i > 0 ? parsed.slice(0, i).map((item) => item.version) : [],
      gapFromPrevious: gap,
    });
  }
  return ordered;
}

// 说清两个版本到底差在第几段、各是多少，例如“次版本号 6 → 7（相差 1）”
function coresEqual(a, b) {
  return a.core[0] === b.core[0] && a.core[1] === b.core[1] && a.core[2] === b.core[2];
}

function describeGap(lower, higher, segment) {
  const names = ['主版本号', '次版本号', '修订号'];
  // 三段数字完全相同，只差有没有预发布后缀：正式版排在预发布版之后
  if (coresEqual(lower, higher)) {
    if (lower.prerelease && higher.prerelease === null) {
      return `${lower.version} 还是预发布版（后缀 ${lower.prerelease}），${higher.version} 已是正式版，正式版更稳妥`;
    }
    if (lower.prerelease === null && higher.prerelease) {
      return `${lower.version} 是正式版，${higher.version} 带预发布后缀 ${higher.prerelease}`;
    }
    return `预发布后缀不同：${lower.prerelease} → ${higher.prerelease}`;
  }
  const from = lower.core[segment];
  const to = higher.core[segment];
  const diff = to - from;
  return `${names[segment]} ${from} → ${to}（相差 ${diff}）`;
}

// 把同一依赖名下的登记按版本归成组
function groupByName(data) {
  const groups = new Map();
  data.deps.forEach((dep) => {
    const key = dep.name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { name: dep.name, displayName: dep.name, deps: [] });
    }
    const group = groups.get(key);
    group.deps.push(dep);
    // 登记大小写理论上已被同项目重名校验约束，跨项目仍可能出现大小写差异，固定取最短的写法展示
    if (dep.name.length < group.displayName.length) group.displayName = dep.name;
  });
  return groups;
}

function buildEntries(deps, projectMap) {
  return deps.map((dep) => ({
    depId: dep.id,
    projectId: dep.projectId,
    projectName: projectMap.get(dep.projectId) || dep.projectId,
    version: dep.version,
    owner: dep.owner,
    status: dep.status,
    license: dep.license,
    note: dep.note,
    updatedAt: dep.updatedAt,
  }));
}

// 汇总一个依赖组：项目数、版本分布、一致性、推荐版本与依据、高低关系
function summarize(group, projectMap) {
  const entries = buildEntries(group.deps, projectMap);
  const versionMap = new Map();
  entries.forEach((entry) => {
    if (!versionMap.has(entry.version)) versionMap.set(entry.version, { version: entry.version, projectIds: [], count: 0 });
    const bucket = versionMap.get(entry.version);
    bucket.projectIds.push(entry.projectId);
    bucket.count += 1;
  });
  const parsedOf = new Map();
  const versions = Array.from(versionMap.values())
    .map((bucket) => {
      const parsed = parseVersion(bucket.version);
      if (parsed) parsedOf.set(bucket.version, parsed);
      return {
        version: bucket.version,
        count: bucket.count,
        projectIds: bucket.projectIds,
        projectNames: bucket.projectIds.map((id) => projectMap.get(id) || id),
      };
    })
    .sort((a, b) => {
      const pa = parsedOf.get(a.version);
      const pb = parsedOf.get(b.version);
      if (pa && pb) return compareParsed(pa, pb);
      return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
    });

  const consistent = versions.length === 1;
  const order = describeOrder(versions);
  const highest = order.length ? order[order.length - 1].version : '';
  const recommendation = chooseRecommendation(versions, order, highest, consistent);

  return {
    name: group.displayName,
    projectCount: entries.length,
    distinctVersionCount: versions.length,
    consistent,
    versions,
    order,
    highestVersion: highest,
    recommendation,
    entries,
  };
}

// 推荐依据：优先被最多项目使用的版本（多数口径，迁移面最小、最稳妥）；
// 最高票并列时取其中版本号更高的；全部一致就直接推荐当前版本
function chooseRecommendation(versions, order, highest, consistent) {
  if (consistent) {
    return {
      version: versions[0].version,
      reason: '所有项目用的都是同一个版本，无需统一',
      basis: 'unanimous',
      maxCount: versions[0].count,
    };
  }
  const maxCount = Math.max(...versions.map((item) => item.count));
  const top = versions.filter((item) => item.count === maxCount);
  const topSet = new Set(top.map((item) => item.version));
  const total = versions.reduce((sum, item) => sum + item.count, 0);
  // 票数相同的几个版本里，按版本高低取更靠后的那个
  const picked = order
    .filter((item) => topSet.has(item.version))
    .map((item) => item.version)
    .pop();
  if (top.length === 1) {
    return {
      version: picked,
      reason: `被最多项目使用（${maxCount} / ${total} 个项目），按多数口径统一改动面最小、最稳妥`,
      basis: 'most-used',
      maxCount,
    };
  }
  return {
    version: picked,
    reason: `得票并列最多：${top.length} 个版本各有 ${maxCount} 个项目使用（共 ${total} 个项目），在并列版本中取版本号更高的 ${picked}`,
    basis: 'most-used-tie-higher',
    maxCount,
  };
}

function getGroup(data, name) {
  const key = pickText(name).toLowerCase();
  if (!key) throw new ApiError(400, 'DEP_NAME_REQUIRED', '请填写依赖名称', 'name');
  const groups = groupByName(data);
  const group = groups.get(key);
  if (!group) throw new ApiError(404, 'DEP_NAME_NOT_FOUND', '没有任何项目登记过这个依赖', 'name');
  return group;
}

// 依赖汇总清单，默认不一致的排前面
function listVersions(options) {
  const input = options && typeof options === 'object' ? options : {};
  const onlyInconsistent = input.onlyInconsistent === true || input.onlyInconsistent === 'true';
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();
  const projectMap = new Map(data.projects.map((item) => [item.id, item.name]));

  const allItems = Array.from(groupByName(data).values())
    .map((group) => summarize(group, projectMap));
  const totals = {
    dependencyCount: allItems.length,
    inconsistentCount: allItems.filter((item) => !item.consistent).length,
    projectCount: data.projects.length,
  };

  let items = allItems;
  if (onlyInconsistent) items = items.filter((item) => !item.consistent);
  if (keyword) items = items.filter((item) => item.name.toLowerCase().includes(keyword));

  items.sort((a, b) => {
    if (a.consistent !== b.consistent) return a.consistent ? 1 : -1;
    if (a.distinctVersionCount !== b.distinctVersionCount) return b.distinctVersionCount - a.distinctVersionCount;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return {
    totals,
    versions: items.map(stripEntries),
  };
}

// 列表项不带逐条明细，下钻时再单独取
function stripEntries(item) {
  const { entries, ...rest } = item;
  return rest;
}

// 某条依赖的下钻：具体项目与登记条目
function getVersionDetail(name) {
  const data = load();
  const projectMap = new Map(data.projects.map((item) => [item.id, item.name]));
  return summarize(getGroup(data, name), projectMap);
}

// 预演与执行共用一套计算：把目标版本之外的登记列成改动清单
function planUnify(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const targetVersion = validateVersion(input.targetVersion === undefined ? input.version : input.targetVersion);
  const data = load();
  const projectMap = new Map(data.projects.map((item) => [item.id, item.name]));
  const group = getGroup(data, input.name);
  const summary = summarize(group, projectMap);

  if (!summary.versions.some((item) => item.version === targetVersion)) {
    throw new ApiError(
      400,
      'TARGET_VERSION_UNKNOWN',
      `目标版本 ${targetVersion} 不在现有登记里，统一只能选已经有项目在用的版本`,
      'targetVersion',
    );
  }

  const changes = [];
  const unchanged = [];
  summary.entries.forEach((entry) => {
    if (entry.version === targetVersion) {
      unchanged.push(entry);
    } else {
      changes.push({ ...entry, fromVersion: entry.version, toVersion: targetVersion });
    }
  });

  return {
    name: summary.name,
    targetVersion,
    consistent: summary.consistent,
    projectCount: summary.projectCount,
    changeCount: changes.length,
    changes,
    unchanged,
    currentVersions: summary.versions,
    order: summary.order,
    recommendation: summary.recommendation,
  };
}

function previewUnify(payload) {
  return { preview: planUnify(payload) };
}

// 真正落盘：只改版本号，其余字段（责任人、状态、许可、备注）原样保留
function executeUnify(payload) {
  const plan = planUnify(payload);
  if (plan.changeCount === 0) {
    throw new ApiError(409, 'UNIFY_NO_CHANGE', `${plan.name} 所有登记已经都是 ${plan.targetVersion}，没有需要改的条目`, 'targetVersion');
  }
  const data = load();
  const nameKey = plan.name.toLowerCase();
  const changeIds = new Set(plan.changes.map((item) => item.depId));
  const now = new Date().toISOString();
  const affectedProjects = new Map();

  data.deps.forEach((dep) => {
    if (dep.name.toLowerCase() === nameKey && changeIds.has(dep.id)) {
      affectedProjects.set(dep.projectId, dep.version);
      dep.version = plan.targetVersion;
      dep.updatedAt = now;
    }
  });
  save(data);

  const projectMap = new Map(data.projects.map((item) => [item.id, item.name]));
  const changes = plan.changes.map((item) => ({
    depId: item.depId,
    projectId: item.projectId,
    projectName: projectMap.get(item.projectId) || item.projectName,
    fromVersion: item.fromVersion,
    toVersion: item.toVersion,
  }));

  return {
    result: {
      name: plan.name,
      targetVersion: plan.targetVersion,
      changedAt: now,
      changeCount: changes.length,
      projectCount: affectedProjects.size,
      changes,
    },
  };
}

module.exports = {
  listVersions,
  getVersionDetail,
  previewUnify,
  executeUnify,
  parseVersion,
};
