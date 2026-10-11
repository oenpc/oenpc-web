/**
 * 面锚定的约束声明 —— STRATA 的 A（锚定）维。
 *
 * ## 这个文件为什么长这样
 *
 * 判决层的核心**不是检查逻辑，而是约束怎么声明适用范围**。
 * 所以每条约束的 `scope` 写的是**坐标**（架构层 × 业务域），**不是文件列表**。
 *
 * **自检**（索引 §0.1 / quickstart §4）：随便想一个你明天可能要新建的文件，
 * 问自己「它落在哪个面上？那个面上已有的约束自动适用于它吗？」
 * 若答案是「是」，锚定就生效了 —— **你不需要为它写任何新规则**。
 * 若答案是「不是，我得为它写新规则」，说明这个面切得不对，或者它确实是个新面。
 *
 * ## 契约（三条，必须严格遵守）
 *
 * | 退出码 | 含义 | 要求 |
 * |---|---|---|
 * | **0** | 通过 | 无输出或简短摘要 |
 * | **1** | 失败 | **必须**输出：约束 id、文件、行号、为什么、怎么改 |
 * | **2** | **无法判定** | 明确说明哪条规则判不了、为什么 |
 *
 * **必须支持退出码 2。** 很多规则不可判定。强迫给出 pass/fail 只会产出**假信号** ——
 * 而假信号比没有信号更糟，因为它让 Agent 和人**都以为检查过了**。
 *
 * ## 还没有检查形态的约束
 *
 * `check: null` 表示「这条约束目前只能靠人读」。这类约束会被判决层如实报成
 * **无法判定（2）**，而不是假装通过 —— 这让「规则的散文形态」与「可执行形态」
 * 之间的缺口**可见**。按 STRATA 的实验假设，写不出检查形态的约束大概率不会生效。
 */

export const constraints = [
  /* ───────────────────────── 有可执行检查形态 ───────────────────────── */

  {
    id: 'runtime-config',
    scope: { layers: ['E', 'X'], domains: ['CO', 'ST'] },
    why: 'API 基址若在构建期写死，同一份产物无法在测试/生产复用；改地址必须重新构建。',
    symptom: '换环境要重新构建；前端指向错误的后端。',
    check: 'checks/no-hardcoded-api-base.mjs',
  },
  {
    id: 'no-sql-in-routes',
    scope: { layers: ['R', 'C'] },
    why: 'SQL 只允许出现在 repositories/ 与 db/。这是「预留 PostgreSQL」唯一可验证的形态。',
    symptom: '换 PG 时要改遍所有路由。',
    check: 'checks/no-sql-outside-repositories.mjs',
  },
  {
    id: 'portable-sql',
    scope: { layers: ['D'], domains: null },
    why: 'SQLite 专有语法必须集中在方言适配层 —— 这是「预留 PostgreSQL 对接」可机械检查的那一半。',
    symptom: '切 PG 时逐处报语法错；「预留」成了一句空话。',
    check: 'checks/portable-sql.mjs',
  },
  {
    id: 'no-hardcoded-copy',
    scope: { layers: ['V', 'O'] },
    why: '界面文案必须走 locale 资源，否则多语言站点必然出现单语残留。',
    symptom: '切到英文后页面里仍夹着中文。',
    check: 'checks/no-hardcoded-copy.mjs',
  },
  {
    id: 'index-integrity',
    repoWide: true,
    scope: {},
    why: '索引过期比没有索引更危险（它看起来权威）。把「记得更新」变成机械检查。',
    symptom: '新增文件没有条目；条目指向已删除的路径；坐标写错导致判决层解析不到。',
    check: 'checks/index-integrity.mjs',
  },

  /* ────────────────────── 暂无可执行形态（check: null）──────────────────────
   * 这些约束照样是**硬约束**，只是当前只能靠人读。
   * 判决层会把它们报成「无法判定」，缺口因此可见。
   * 给它们补上可执行形态是 V 层的待办 —— 见索引 §4 的「检查形态」列。
   */

  {
    id: 'same-origin-first',
    scope: { layers: ['E'], domains: ['CO'] },
    why: '同源反代一次性规避 CORS、Cookie SameSite、SSE Origin 三类问题；真跨域时必须用 Authorization 头。',
    symptom: 'CORS 预检失败 / Cookie 被丢弃 / SSE 连不上。',
    check: null,
    manual: '需要评审 nginx 配置与请求封装，静态扫描无法判定「是否真跨域」。',
  },
  {
    id: 'every-public-page-has-url',
    scope: { layers: ['V', 'X', 'N'], domains: ['PD', 'CT', 'ST'] },
    why: '外贸站流量靠自然搜索；没有独立 URL 的内容等于不存在。',
    symptom: 'Google 抓不到 → 自然流量为 0。',
    check: null,
    manual: '需要对照构建产物里的静态路由枚举清单，属于构建期产物检查（待骨架落地后补）。',
  },
  {
    id: 'utc-storage',
    scope: { layers: ['C', 'S', 'D'], domains: null },
    why: '存储与传输一律 ISO8601 UTC，展示层才做时区转换。',
    symptom: '跨时区显示错 8 小时；时间排序错乱。',
    check: null,
    manual: '「是否业务时间」无法静态判定 —— 误报会立刻被绕过，而一个开始喊狼来了的约束会失效。',
  },
  {
    id: 'error-code-not-text',
    scope: { layers: ['R', 'C', 'S'], domains: null },
    why: '后端返回错误码，文案由前端 locale 渲染 —— 否则后端无法多语言。',
    symptom: '切英文后报错仍是中文。',
    check: null,
    manual: '需要识别「响应体里的展示文案」，静态扫描容易误伤日志与调试信息。',
  },
  {
    id: 'multi-locale-schema',
    scope: { layers: ['D'], domains: ['PD', 'CT', 'ST'] },
    why: '业务文本逐字段多语（翻译表 + 语种键），禁止 name_zh/name_en 硬分支，必须支持 ≥3 语种。',
    symptom: '加第三语种要改表结构与全部代码。',
    check: null,
    manual: '需要评审表结构；`_zh`/`_en` 后缀扫描可作为启发式，但列名约定尚未落地。',
  },
  {
    id: 'shared-contract',
    scope: { layers: ['X', 'R', 'S'], domains: null },
    why: '改前后端契约必须同步 packages/shared，禁止两端各写一份。',
    symptom: '类型漂移，运行时字段对不上。',
    check: null,
    manual: '需要分析两端类型定义的重复度，属于结构性判断而非模式匹配。',
  },
  {
    id: 'upload-limits-both-sides',
    scope: { layers: ['E', 'R'], domains: ['MD'] },
    why: '上传体积上限必须在 nginx 与 Fastify 两侧同时放开。',
    symptom: 'nginx 先返回 413，看起来像后端 bug。',
    check: null,
    manual: '需要同时读 nginx 配置片段与 Fastify 注册参数，待部署配置落地后补。',
  },
  {
    id: 'append-only-audit',
    scope: { layers: ['D', 'S'], domains: ['AL'] },
    why: '审计日志只追加，不提供更新与删除入口。',
    symptom: '审计失去证据效力。',
    check: null,
    manual: '可检查「审计表上是否存在 update/delete 语句」，待审计域落地后补。',
  },
]
