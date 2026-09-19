// 版本解析与高低比较。登记口径要求三段数字，但早期数据里可能留着两段写法
// （例如 1.70），汇总时只做对照、不做保存，所以这里按宽松口径解析，缺的段补 0。

const SEGMENT_NAMES = ['第一段数字（主版本号）', '第二段数字（次版本号）', '第三段数字（修订号）'];

// 拆成三段数字加可选的预发布后缀；实在拆不出来的版本按 0.0.0 处理，保证对照不会中断
function parseVersion(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.]+))?$/);
  if (!match) {
    return { raw, core: [0, 0, 0], prerelease: null, regular: false };
  }
  return {
    raw,
    core: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
    prerelease: match[4] === undefined ? null : match[4],
    regular: true,
  };
}

// 预发布后缀按点拆成几段比较：纯数字的段按数值比（rc.10 高于 rc.2），其余段按文本比
function comparePrerelease(left, right) {
  const partsA = left.split('.');
  const partsB = right.split('.');
  const count = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < count; i += 1) {
    const a = partsA[i];
    const b = partsB[i];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const numA = /^\d+$/.test(a) ? Number(a) : null;
    const numB = /^\d+$/.test(b) ? Number(b) : null;
    if (numA !== null && numB !== null && numA !== numB) return numA < numB ? -1 : 1;
    if (numA !== null && numB === null) return -1;
    if (numA === null && numB !== null) return 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

// 三段数字逐段比，数字部分相同再看预发布后缀：正式版高于带后缀的预发布版
function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

// 两个版本第一个不一样的段：0/1/2 对应主版本号、次版本号、修订号；
// 三段数字都相同只差预发布后缀时归到 prerelease；完全相同为 none
function diffSegment(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) {
      return { index: i, key: ['major', 'minor', 'patch'][i], label: SEGMENT_NAMES[i] };
    }
  }
  if (left.prerelease !== right.prerelease) {
    return { index: -1, key: 'prerelease', label: '预发布后缀' };
  }
  return { index: -1, key: 'none', label: '' };
}

// 说清 from 到 to 的高低关系以及差在第几段数字，例如：
// 2.6.15 → 2.7.18：「比目标版本低，差在第二段数字（次版本号 6 → 7）」
function describeRelation(from, to) {
  const cmp = compareVersions(from, to);
  if (cmp === 0) return { order: 'equal', segment: 'none', text: '与目标版本一致' };
  const diff = diffSegment(from, to);
  const left = parseVersion(from);
  const right = parseVersion(to);
  const order = cmp < 0 ? 'lower' : 'higher';
  const orderText = cmp < 0 ? '比目标版本低' : '比目标版本高';
  let detail;
  if (diff.key === 'prerelease') {
    detail = `只差在预发布后缀（${left.prerelease || '正式版'} → ${right.prerelease || '正式版'}）`;
  } else {
    detail = `差在${diff.label}（${left.core[diff.index]} → ${right.core[diff.index]}）`;
  }
  return { order, segment: diff.key, segmentIndex: diff.index, text: `${orderText}，${detail}` };
}

// 相邻版本之间的跨度描述，用在版本高低序列上，例如「2.6.15 ──次版本号──▶ 2.7.18」
function describeGap(from, to) {
  const diff = diffSegment(from, to);
  if (diff.key === 'none') return '相同';
  if (diff.key === 'prerelease') return '预发布后缀不同';
  return `差在${diff.label}`;
}

module.exports = {
  SEGMENT_NAMES,
  parseVersion,
  compareVersions,
  diffSegment,
  describeRelation,
  describeGap,
};
