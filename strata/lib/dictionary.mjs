/**
 * 字典的机读副本 —— STRATA 的 R（面）维。
 *
 * ⚠️ **权威是人读的 `docs/strata-index.md` §0**，本文件只是它的机读投影。
 *    加/删一个层、域或特征标记时：**先改 §0，再改这里**。
 *    两者是否一致由 `strata/checks/index-integrity.mjs` 校验（防漂移）。
 *
 * 面（face）= ⟨架构层, 业务域⟩，是有限集合 L × B 的元素。
 * 本字典：|L| = 11，|B| = 12，面数上界 = **132**。
 * 「有限」这一点是 STRATA 成本定理的前提：约束只能挂在有限个地方。
 */

/** A 维 —— 架构层（11 个，封闭）。按「改动它会不会波及别处」切，不按框架名切。 */
export const LAYERS = new Map([
  ['E', 'Entry'],
  ['R', 'Route'],
  ['C', 'Core'],
  ['S', 'Service'],
  ['D', 'Data'],
  ['V', 'View'],
  ['O', 'Component'],
  ['X', 'Client'],
  ['N', 'Locale'],
  ['K', 'Contract'],
  ['T', 'Tool'],
])

/** B 维 —— 业务域（12 个，封闭）。由 docs/功能清单.md §5 的映射推导。 */
export const DOMAINS = new Map([
  ['CO', '基础设施 / 配置 / 装配 / 持久化机制'],
  ['AU', '认证与授权（含 TOTP）'],
  ['PD', '产品'],
  ['CT', '内容（首页 / 关于 / 新闻）'],
  ['CH', '购买渠道'],
  ['IQ', '询盘'],
  ['MD', '媒体'],
  ['ST', '站点设置 / SEO / 多语言'],
  ['AN', '报表与导出'],
  ['AL', '审计日志'],
  ['UI', '前端壳与通用组件'],
  ['SC', '仓库级脚本与回归'],
])

/** C 维 —— 重要性（6 级非均匀）。非均匀是有意的：核心文件保留细粒度，外围合并压缩。 */
export const IMPORTANCE = new Set([9, 8, 7, 5, 3, 1])

/** E 维 —— 规模（4 级，按行数）：XL ≥1500 · L ≥500 · M ≥150 · S <150 */
export const SCALES = new Set(['XL', 'L', 'M', 'S'])

/** D 维 —— 技术特征（12 个，**封闭标记表**）。自由拼写会让判决层无法解析。 */
export const FEATURES = new Set([
  'I18N', // 多语言相关（文案 / URL / 双语字段 / 语种表）
  'SEO', // 影响搜索引擎收录（meta / sitemap / hreflang / URL 结构 / JSON-LD）
  'SSG', // 构建期预渲染约定（构建期数据获取、静态路由枚举）
  'UTC', // 时间处理（存储 UTC / 展示转换）
  'SSE', // 服务端推送长连接
  'UPL', // 文件上传（体积 / 类型 / 流式）
  'XLSX', // Excel / CSV 导入导出
  'SQL', // 直接操作 SQLite / 手写迁移
  'PG', // PostgreSQL 兼容性敏感（方言 / 占位符 / 事务 / 大小写）
  'SEC', // 安全边界（鉴权 / 转义 / 路径 / 限流）
  'PERF', // 性能敏感（首屏 / 图片 / 缓存）
  'HZ', // 历史坑集中处（见索引 §4）
])

/**
 * 条目行的**机检正则**（定义见索引 §0.1）。
 * 改这里必须同步改 `docs/strata-index.md` §0.1，否则判决层与文档会漂移。
 *
 * 为什么用 `·` 分隔而不是拼成 `[CCPL9]`：STRATA `reference.md` §4.1 记录了一条实测教训 ——
 * 早期自由串标签在机器解析时产生歧义（层 1 字符 + 域 2 字符的边界在特定组合下不可区分）。
 */
export const ENTRY_RE =
  /^(\S+?)\[([A-Z])·([A-Z]{2})·([987531])·([A-Z0-9,]*)·(XL|L|M|S)\]:/

/** 形似条目但坐标非法 —— 用于把「格式写错」**报出来**，而不是静默忽略。 */
export const MALFORMED_RE = /^(\S+?)\[([^\]]+)\]:/

/** 索引文件（相对仓库根）。 */
export const INDEX_PATH = 'docs/strata-index.md'

/**
 * 参与「索引完整性」统计的源码扩展名。
 *
 * `.sh` / `.bash` 也要算 —— 部署脚本是**会被执行**的代码，
 * 不纳入统计就是索引完整性的盲区（同 tests/ 的道理）。
 */
export const SOURCE_EXTS = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.mjs', '.cjs',
  '.vue',
  '.sh', '.bash',
]

/**
 * 参与统计的源码根目录。
 *
 * `tests` 也必须在这里 —— 否则测试文件是**索引完整性的盲区**：
 * 它们不进统计，也就永远不需要条目，而"索引过期比没有索引更危险"。
 * 用一条目录条目覆盖整个 `tests/` 即可（见索引 §2.5）。
 */
export const SOURCE_ROOTS = ['apps', 'packages', 'scripts', 'strata', 'tests']

/** 永不进入统计的目录（构建产物与依赖）。 */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-ssr', 'build', 'release', 'coverage',
  '.tmp-verify', '.pnpm-store', '.vite', '.output', '.nuxt', '.cache',
])
