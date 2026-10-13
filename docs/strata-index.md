# OENPC-WEB 的 STRATA 实例索引

> 本文件是 **OENPC-WEB 专有的 STRATA 实例索引**，遵循 `D:\工作区\STRATA`（MIT）的协议：
> **把约束锚定在坐标类上，而不是文件上 —— 于是新文件继承规则，而不是产生新规则。**
>
> 索引是六要素中 **S（点）** 与 **T（线）** 的载体；**R（面）** 由 §0 的字典定义；
> **A（锚定）** 与 **V（判决）** 在 `strata/constraints.mjs` 与 `strata/checks/` 实现。
>
> | 层 | 要素 | 落点 |
> |---|---|---|
> | S 点 | 文件与其一行表示 | 本文件 §2 |
> | T 线 | 类型化跨文件依赖 | 本文件 §2 的 `R:` 字段 + §3 |
> | R 面 | 坐标 `⟨架构层, 业务域⟩` | 本文件 §0 |
> | A 锚定 | 约束挂在**面**上 | `strata/constraints.mjs` |
> | V 判决 | 可执行检查器 | `strata/checks/`（`pnpm strata:check`）|
> | A 空间 | `面 × 面` 组合空间 | 覆盖由列举变为生成 |
>
> **填写顺序不可颠倒**：§0 字典 → §1 全局约束 → §2 条目。
> 反过来会让"面"退化成"点"，方法收益归零。

---

## 0. 编码规则（**字典，先定这一节**）

### 0.1 条目格式（**固定宽度，必须可机检**）

```
路径[层·域·重要性·特征·规模]: F:角色 | R:相关文件 | A:对外接口 | S:细节与陷阱
     └──────── 离散符号层（坐标）────────┘ └──────── 连续语义层 ────────┘
```

**示例**（真实条目的样子）：

```
apps/server/src/routes/products/list.ts[R·PD·7·SEC·M]: F:产品列表接口 | R:services/productService.ts,repositories/productRepository.ts | A:listProducts | S:入参分类 id 与语种都必填；语种决定翻译表关联，漏传会回落到默认语种而不是报错
```

**机检正则**（判决层按此解析，改格式必须同步改 `strata/checks/`）：

```regex
^(\S+?)\[([A-Z])·([A-Z]{2})·([987531])·([A-Z0-9,]*)·(XL|L|M|S)\]:
```

| 字段 | 宽度 | 取值约束 |
|---|---|---|
| 层 | **1 字符** | 必须来自 §0.2 的 `A` 枚举 |
| 域 | **2 字符** | 必须来自 §0.3 的 `B` 枚举 |
| 重要性 | **1 数字** | `{9, 8, 7, 5, 3, 1}`，见 §0.4 |
| 特征 | 0..n | 逗号分隔，**必须全部来自 §0.5 的封闭标记表** |
| 规模 | **1 或 2 字符** | `{XL, L, M, S}`，见 §0.6 |

> **特征为空时写成连续两个 `·`**（例：`T·SC·7··S`）。
> 少一个 `·` 或缺一段，判决层会判为格式非法 —— 而**格式非法 = 该文件的约束不会生效**。
> 这个失败模式由 `pnpm strata:check` 的 `index-integrity` 兜住。

> **为什么用 `·` 分隔而不是像早期版本那样拼成 `[CCPL9]`。**
> STRATA `reference.md` §4.1 记录了一条实测教训：早期自由串标签
> （`CCPL9`、`XCPL8`）在机器解析时产生歧义 —— **层 1 字符 + 域 2 字符的边界
> 在特定组合下不可区分**，而且那时序里"重要性"和"规模"谁在后都不一致。
> 结论：**判决层要能自动核查索引，标签格式就必须无歧义。** 所以本实例用
> `·` 显式分隔，并把"重要性在规模之前"固定下来。

**语义层四要素**（`F` / `R` / `A` / `S`）：

| 字段 | 含义 | 要求 |
|---|---|---|
| `F` | 业务角色 | 一句话，**不复述函数签名** |
| `R` | 相关文件 | 文件名级引用，**不记版本锁定的接口签名** |
| `A` | 对外接口 | 导出的符号名 |
| `S` | 高熵细节 | **设计取舍、约束、陷阱** —— 读代码看不出来的东西 |

> **`S` 是全文最有价值的部分**，也是唯一不能从代码里自动生成的部分。
> **`S` 里禁止粘贴原始代码** —— 压缩成高熵关键词，条目才能长期有效。
>
> | `S` 该写 | `S` 不该写 |
> |---|---|
> | 为什么这么设计（取舍）| 函数签名 |
> | 什么改动会踩坑 | 逐行注释翻译 |
> | 和哪些文件必须**一起**改 | "这个文件定义了 X 类" |
> | 隐含的不变量 | 任何能从代码直接看出的东西 |

**条目粒度：不是"每个文件一条"**（`reference.md` §4.4）。
一个文件值得单独成条 ⇔ 它承担了**别的文件会误用的设计决策**，
或它的改动**会波及他处**；否则并入所属模块的条目。
**依据是"有无非显然的约束"，不是文件大小** ——
一个 11 行的文件如果有个坑，比一个 500 行的样板文件更该有条目。

本实例因此允许两种条目形态：

| 形态 | 写法 | 覆盖范围 |
|---|---|---|
| 文件条目 | `apps/server/src/app.ts[E·CO·9·SEC·M]: F:… \| R:… \| A:… \| S:…` | 该文件 |
| **目录条目** | `apps/server/src/routes/products/[R·PD·7·SEC·M]: F:… \| R:… \| A:… \| S:…` | **该目录下所有文件** |

**目录条目就是面锚定在索引侧的形态：它让"新增同类文件"不必新增条目。**
`strata/checks/index-integrity.mjs` 按这两种形态判定覆盖率，
并在有文件无条目时**失败**（而不是默默放过）。

### 0.2 `A` 维 —— 架构层（**11 个，封闭**）

> **上限必须有限**：面数上界 = `|A| × |B|` = 11 × 12 = **132**。
> 无限枚举的层等于没有面。
> **怎么切的**：按"改动它会不会波及别处"切，**不按框架名切**。

| 码 | 层 | 职责 | 落点 |
|---|---|---|---|
| `E` | Entry | 进程 / 构建入口与装配 | `apps/server/src/index.ts`、`app.ts`、`apps/*/src/main.ts`、`vite.config.*` |
| `R` | Route | HTTP 路由与入参校验 | `apps/server/src/routes/**` |
| `C` | Core | 领域逻辑，**无框架依赖** | `apps/server/src/core/**` |
| `S` | Service | 应用服务与编排（跨仓储 / 外部平台）| `apps/server/src/services/**` |
| `D` | Data | 仓储实现、表结构、迁移 | `apps/server/src/repositories/**`、`db/**` |
| `V` | View | 页面（前台 + 后台）| `apps/web/src/views/**`、`apps/admin/src/views/**` |
| `O` | Component | 可复用组件 | `apps/*/src/components/**` |
| `X` | Client | 前端状态与 API 客户端 | `apps/*/src/stores/**`、`api/**` |
| `N` | Locale | 多语言资源包（各 app 自己的语种资源）| `apps/*/src/locales/**` |
| `K` | Contract | 前后端共享的**类型契约**（纯类型，无运行时）| `packages/shared/src/**` |
| `T` | Tool | 构建、脚本、检查器、文档与仓库根文件 | `scripts/**`、`strata/**`、`docs/**`、`AGENTS.md`、`package.json` |

**为什么是这 11 个**：`R → C → D` 是单向依赖，改 `C` 通常不波及 `D`，反之亦然。
`V / O / X / N` 是前端四类**波及面不同**的单元：改一个 `O` 会波及所有引用它的 `V`；
改 `N` 会波及**所有**层的所有文件（这正是它必须独立成层的原因 ——
i18n 资源是全局波及面，混进 `V` 会让"改文案"看起来像"改页面"）。
`K`（契约）**同时被前后端 import**，改动跨两端传播 —— 这是与其余各层都不同的波及形态。

> **`K` 是骨架落地时补上的**（原字典 10 层，无 K）。原因：`packages/shared` **放不进任何一层** ——
> 它不是 Tool，也不属于任一 app；若硬塞进 `T`（我曾这么写过占位），
> 一次 `error-codes.ts` 的改动就会与 `strata/measure.mjs` 落在同一个面上，
> 锚在 `T·SC` 上的约束会同时管住两者 —— 语义上说不通。
> 按本节的提升规则（某类文件 ≥3 个才提升为层，而它一次就有 5 个文件），它够格独立成层。
>
> **这是字典应当被代码检验的地方**：字典先定稿是对的，但**定稿不等于不可修订** ——
> 修订要走本节的正规顺序（先改 §0，再改条目），`strata/lib/dictionary.mjs` 与
> `strata/measure-index.mjs` 里的 `|L|` 与面数上界要同步改。

> **提升路径（不要提前建层）**：SSG 预渲染脚本（`F6.4`）若成长到 **≥3 个文件**，
> 再提升为独立层 `G`（Generator）。现在它归 `T`。
> **理由**：STRATA `reference.md` §3.4 实测 —— 单文件面的收益为 0，
> 为一个文件建一层只是增加字典噪音。

### 0.3 `B` 维 —— 业务域（**12 个，封闭**）

> 从 [`功能清单.md`](功能清单.md) §5 的映射推导而来 —— **域是业务上独立命名的单元**，
> 不是目录名（`utils`、`components` 是位置，不是域）。

| 码 | 域 | 覆盖功能 | 建议目录名 |
|---|---|---|---|
| `CO` | 基础设施 / 配置 / 装配 / 持久化机制 | P2, P4–P9, P10–P12 | `common` |
| `AU` | 认证与授权（含 TOTP）| F7.1–F7.5, F16.1–F16.2 | `auth` |
| `PD` | 产品 | F2.1–F2.5, F8.1–F8.5, P3 | `products` |
| `CT` | 内容（首页 / 关于 / 新闻）| F1.1–F1.2, F9.1–F9.3 | `content` |
| `CH` | 购买渠道 | F3.1–F3.4, F11.1–F11.2 | `channels` |
| `IQ` | 询盘 | F4.1–F4.4, F12.1–F12.3 | `inquiry` |
| `MD` | 媒体 | F10.1–F10.4, P13–P14 | `media` |
| `ST` | 站点设置 / SEO / 多语言 | F2.6, F5.1–F5.5, F6.1–F6.5, F13.1–F13.4, P1 | `site` |
| `AN` | 报表与导出 | F15.1–F15.4 | `reports` |
| `AL` | 审计日志 | F14.1–F14.3 | `audit` |
| `UI` | 前端壳与通用组件 | F1.3、布局 / 导航 / 主题 | `ui` |
| `SC` | 仓库级脚本与回归 | 构建、检查器、部署脚本 | —（即 `scripts/`）|

> **`PG`（PostgreSQL 兼容）不是域。** 它是**锚在 `D` 层上的约束**，
> 适用于所有域的仓储实现（`scope: { layers: ['D'] }`）。
> **为技术关注点发明一个业务域，是让面退化的典型做法** —— 别做。

### 0.4 `C` 维 —— 重要性（6 级非均匀）

| 值 | 含义 | token 预算 |
|---|---|---|
| **9** | 牵一发动全身：改错会波及全局 | 120–180 |
| **8** | 关键机制：理解它才能安全改动相邻模块 | 100–150 |
| **7** | 重要：高频改动或承载核心业务 | 80–120 |
| **5** | 一般：局部实现 | 50–80 |
| **3** | 外围：可预测的样板 | 25–45 |
| **1** | 可忽略：生成物或配置 | ≤ 20 |

> **非均匀是有意的**：核心文件之间保留细粒度区分，外围文件合并压缩。
> **`C` 就是这个文件的 token 预算** —— 注意力按重要性分配，而不是平均分。

**本项目的预期极值**（用于校准，实际以条目为准）：

| 文件 | 预期 `C` | 为什么 |
|---|---|---|
| `apps/server/src/core/plugin*.ts` 类装配点 | 9 | 装配错会导致整站不可用 |
| 迁移与仓储基类 | 9 | 数据错了不可逆 |
| 语种表 / 翻译表结构 | 9 | 改它要动全部业务数据 |
| 权限点枚举 | 8 | 错一个就是越权或功能消失 |

### 0.5 `D` 维 —— 技术特征（**12 个，封闭标记表**）

> **必须是封闭表**：自由拼写会让判决层无法解析。

| 标记 | 含义 |
|---|---|
| `I18N` | 多语言相关（文案 / URL / 双语字段 / 语种表）|
| `SEO` | 影响搜索引擎收录（meta / sitemap / hreflang / URL 结构 / JSON-LD）|
| `SSG` | 构建期预渲染约定（构建期数据获取、静态路由枚举）|
| `UTC` | 时间处理（存储 UTC / 展示转换）|
| `SSE` | 服务端推送长连接 |
| `UPL` | 文件上传（体积 / 类型 / 流式）|
| `XLSX` | Excel / CSV 导入导出 |
| `SQL` | 直接操作 SQLite / 手写迁移 |
| `PG` | PostgreSQL 兼容性敏感（方言 / 占位符 / 事务 / 大小写）|
| `SEC` | 安全边界（鉴权 / 转义 / 路径 / 限流）|
| `PERF` | 性能敏感（首屏 / 图片 / 缓存）|
| `HZ` | 历史坑集中处（见 §4）|

### 0.6 `E` 维 —— 规模（4 级，按行数）

`XL ≥1500` · `L ≥500` · `M ≥150` · `S <150`

### 0.7 路径约定（**建议，不是硬约束**）

索引条目里的坐标**才是权威**（判决层从本文件解析 `路径 → ⟨层,域⟩`）。
为了让 `measure.mjs` 的目录代理也能给出有意义的近似值，建议：

```
apps/<单元>/src/<层目录>/<域目录>/<文件>
apps/server/src/routes/products/list.ts      → ⟨R, PD⟩
apps/web/src/views/inquiry/Form.vue           → ⟨V, IQ⟩
```

- **层目录名**用 §0.2 的落点（`routes`、`core`、`services`、`repositories`、`views`、`components`、`stores`、`locales`）。
- **域目录名**用 §0.3 的"建议目录名"。
- 文件直接位于层目录下（无域子目录）时，**该文件的域以索引条目为准**。

> **不要为了凑目录而强行三层嵌套。** 目录约定服务于人类与测量工具；
> 约束锚定的正确性只依赖索引里的坐标。

---

## 1. 项目总览

**OENPC-WEB** 是一个**通用型企业外贸展示网站**：前台为双语（可扩展多语种）
产品展示站点，构建期静态预渲染；后台为内容管理系统；两者共享一套 Fastify +
SQLite（预留 PostgreSQL）应用服务。

```
┌─ A 机 ─────────────────────────────────┐        ┌─ B 机 ────────────────────────────┐
│ nginx                                  │        │ node + Fastify（systemd）          │
│  ├─ /            前台 SSG 静态产物      │        │  ├─ routes/   （R）                │
│  ├─ /admin/      后台 SPA 静态产物      │  同源  │  ├─ core/     （C）无框架依赖      │
│  ├─ ^~ /api/   ────────────────────────┼───────►│  ├─ services/ （S）编排            │
│  └─ ^~ /events/ ── SSE，proxy_buffering │        │  ├─ repositories/ + db/ （D）      │
│                     off 必须显式设置   │        │  └─ SQLite（起步）→ PG（预留）     │
└────────────────────────────────────────┘        └───────────────────────────────────┘
        ▲ 前台 apps/web（SSG）  ▲ 后台 apps/admin（SPA）
        └──────── packages/shared（契约，纯类型）────────┘
```

**核心架构决策**：**同源反代**，不做真跨域。A 机把 `/api` 与 `/events` 反代到 B 机 ——
一次性规避 CORS、Cookie `SameSite`、SSE `Origin` 三类问题。

### 全局硬约束（**改任何地方前先看**）

| # | 约束 | 违反症状 | 约束 id |
|---|---|---|---|
| 1 | **API 基址必须运行时可配**（`/config.json` 或 `window.__APP_CONFIG__` 注入），禁止用 `import.meta.env` 在构建期写死 | 同一份构建产物无法在测试/生产复用；改地址要重新构建 | `runtime-config` |
| 2 | **优先同源反代**；确需跨域时用 `Authorization` 头而**不用 Cookie** | CORS 预检失败 / Cookie 被 `SameSite` 丢弃 / SSE 连不上 | `same-origin-first` |
| 3 | **所有对外可索引页面必须有确定的 URL**，由构建期枚举生成；禁止"只能点进去、没有独立 URL"的内容 | Google 抓不到 → 自然流量为 0 | `every-public-page-has-url` |
| 4 | **时间一律存 UTC**：库与 API 传输 ISO8601 UTC，展示层按访客/运营者时区转换 | 跨时区显示错 8 小时；排序错乱 | `utc-storage` |
| 5 | **后端只返回错误码，不返回成品文案**；文案由前端 locale 渲染 | 切英文后报错仍是中文 | `error-code-not-text` |
| 6 | **业务文本逐字段多语**（翻译表 + 语种键），禁止 `name_zh`/`name_en` 硬分支，**必须支持 ≥3 语种** | 加第三语种要改表结构与全部代码 | `multi-locale-schema` |
| 7 | **路由层禁止直接写 SQL**；SQL 只出现在 `repositories/` 与 `db/` | 换 PG 要改遍所有路由 | `no-sql-in-routes` |
| 8 | **SQLite 专有语法必须集中在方言适配层**（禁 `INSERT OR REPLACE` / `AUTOINCREMENT` / `datetime('now')` 散落） | 切 PG 时逐处报语法错 | `portable-sql` |
| 9 | **改前后端契约必须同步 `packages/shared`**，禁止两端各写一份 | 类型漂移，运行时字段对不上 | `shared-contract` |
| 10 | **上传体积上限必须 nginx 与 Fastify 两侧同时放开** | nginx 先返回 413，看起来像后端 bug | `upload-limits-both-sides` |
| 11 | **文案不得硬编码在组件/模板里**，一律走 locale 资源 | 多语言站点出现单语残留 | `no-hardcoded-copy` |
| 12 | **审计日志只追加**，不提供更新与删除入口 | 审计失去证据效力 | `append-only-audit` |

> 这 12 条同时是 `strata/constraints.mjs` 的约束来源，**但约束锚定在面上**（见该文件的 `scope`），
> 不锚定在文件列表上 —— 新增一个 `products` 域的路由时，`no-sql-in-routes` 自动覆盖它，
> **不需要新写规则**。
> `constraints.mjs` 里还有第 13 条 `index-integrity`，它来自 §5 的维护协议
> （索引完整性是机械检查项，不属于产品硬约束）。

---

## 2. 文件级索引

> 说明：`R` 只记**文件名级**依赖（协议如此），不做函数级调用链 ——
> 需要精确调用链时仍需读源码。
> **目录条目**（路径以 `/` 结尾）覆盖该目录下所有文件，见 §0.1。

### 2.1 规范层（STRATA 实例自身 —— ✅ 已落地）

```
AGENTS.md[T·SC·9··M]: F:面向 AI 编码代理的工作约定（本仓库最硬的规则层）|
  R:docs/strata-index.md,docs/功能清单.md,strata/constraints.mjs | A:- |
  S:改代码前先读它，它比 README 更硬。三处最容易被忽略：
    · 「退出码 2 不等于通过」—— 不写这句，Agent 会把"无法判定"当成成功
    · 禁止先写条目后补字典（会让面退化成点，方法收益归零）
    · 临时产物只放 .tmp-verify/，且不要提交里面写好的脚本

package.json[T·SC·7··S]: F:仓库根：脚本入口与运行时约束 |
  R:strata/checks/run-all.mjs,strata/measure.mjs,strata/measure-index.mjs |
  A:strata:check / strata:measure / strata:measure:index |
  S:engines 锁 node>=22.19.0（依赖内置 node:sqlite）；
    strata:measure 的 --layers/--domains 传的是**目录名**而不是层/域码 ——
    measure.mjs 按目录段匹配，传码会让全部路径落到 (unknown)

docs/strata-index.md[T·SC·9··M]: F:本仓库的 STRATA 实例索引（**坐标的权威来源**）|
  R:strata/lib/dictionary.mjs,strata/lib/parse-index.mjs,strata/constraints.mjs | A:- |
  S:★ 判决层从本文件 §2 解析「路径 → ⟨层,域⟩」，所以**条目格式写错 = 该文件的约束不生效**；
    §0 字典是权威，strata/lib/dictionary.mjs 只是机读投影（漂移由 index-integrity 抓）；
    条目正文**必须落在 §2 小节内** —— §0.1 有一条格式正确的示例条目，
    全文扫描会把那个例子当成真条目收进来

docs/开发计划.md[T·SC·8··M]: F:分阶段开发计划（P0–P6）与排序依据 |
  R:docs/功能清单.md,docs/strata-index.md | A:- |
  S:★ 先读 §0 的四条排序原则 —— 顺序错了后面要成倍返工；
    P0 的三项（仓储接口抽象 / 测试基线 / SSG spike）都是"现在做便宜、以后做贵"的类型，
    所以排在所有业务之前；「关键路径」一节说明为什么 P2.7 依赖 P1 的构建产物；
    「必须在开工前定的决策」第 2 条（URL 结构）最贵 —— 一旦被搜索引擎收录，再改就是丢排名

docs/功能清单.md[T·SC·8··M]: F:产品功能清单（**B 维业务域的上游**）|
  R:docs/strata-index.md,docs/开发计划.md | A:- |
  S:★ 改业务域的顺序是：功能清单 → §0.3 字典 → 条目，**不能跳**；
    §6 决策记录留了"否掉的选项及理由"（多租户 / SSR / 纯 SPA / WebSocket / ISR），
    用来避免日后反复讨论同一件事

strata/constraints.mjs[T·SC·9··S]: F:面锚定的约束声明（A 层）|
  R:strata/checks/**,docs/strata-index.md | A:constraints |
  S:★ `scope` 必须写**坐标**，禁止写文件列表 —— 写成列表就退化为逐点制，锚定收益归零；
    `check: null` 是**诚实标记**（该约束尚无执行形态），判决层报成"无法判定"而**不是通过**；
    改本文件要**单独提交**，让"约束引入的时刻"可追溯（判据见 AGENTS.md §4）

strata/checks/[T·SC·8··M]: F:判决层（V）—— 三值检查器集合 |
  R:strata/constraints.mjs,strata/lib/parse-index.mjs | A:各检查导出的 run({root,targets}) |
  S:★ **目录条目**：新增一个检查器不需要新条目，这就是面锚定在索引侧的形态；
    契约固定 0=通过 / 1=失败 / 2=无法判定；
    run-all 把"没有可判定对象"也归为 2 ——「没找到问题」与「没检查」是两件事；
    检查器**自身崩溃按 2 处理**，不当成通过

strata/lib/dictionary.mjs[T·SC·8··S]: F:字典的机读投影（R 维）|
  R:docs/strata-index.md,strata/lib/parse-index.mjs | A:LAYERS,DOMAINS,FEATURES,ENTRY_RE |
  S:★ 权威是索引 §0，本文件只是投影：加层/域/特征要**先改 §0 再改这里**；
    |L|=11、|B|=12 ⇒ 面数上界 132；
    ENTRY_RE 用 `·` 分隔而不是拼成 [CCPL9] —— 早期自由串标签的层/域边界
    在特定组合下不可区分（reference.md §4.1 的实测教训）

strata/lib/parse-index.mjs[T·SC·8··S]: F:索引解析与源码清点 |
  R:strata/lib/dictionary.mjs | A:parseIndex,collectSourceFiles,computeCoverage,resolveScope,computeKappa |
  S:条目只在 `## 2.`–`## 3.` 之间解析（这是为了绕开 §0.1 的示例条目）；
    覆盖率按两种形态判定：文件条目 + 目录条目；
    条目指向不存在的路径时报"索引过期"——**过期索引比没有索引更危险，它看起来权威**

strata/measure.mjs[T·SC·5··M]: F:上游 STRATA 的 κ/γ 测量工具（目录结构代理面）|
  R:strata/measure-index.mjs | A:- |
  S:★ 复制自 D:\工作区\STRATA（MIT，见 strata/LICENSE-STRATA）——
    要改测量逻辑请**去上游改再同步回来**，否则两处漂移；
    **它用目录结构代理面，所以 κ 系统性偏高、只是上界**（同目录⇒同面是构造必然，
    实测同一仓库 depth=1..4 下 κ 恒在 0.94–0.99）；
    本文件真正的价值在 **γ**（需要 git 历史）与目录规模画像

strata/measure-repo.mjs[T·SC·5··S]: F:κ 测量的诚实包装（挡住「适用」假信号）|
  R:strata/measure.mjs,strata/measure-index.mjs | A:- |
  S:★ 上游 measure.mjs 在**字典与仓库结构不匹配**时照样会喊「适用」：
    匹配不上的目录段被归成 (unknown)，而 (unknown) 面**恰好是共享面**，κ 仍是 1.0。
    这比"目录代理偏高"更危险 —— 配置看起来权威（显式字典），结论却是垃圾；
    本包装在 >50% 文件落到 (unknown) 时**拒绝出结论并退出 2**；
    它**不改** measure.mjs（上游 MIT 文件，改逻辑要去上游改再同步）

strata/measure-index.mjs[T·SC·7··S]: F:从索引条目算**权威 κ** |
  R:strata/lib/parse-index.mjs,docs/strata-index.md | A:- |
  S:★ 这才是能拿来下结论的数（口径 = 索引坐标，不是目录结构）；
    条目为 0 时**退出 2**，不打印 0/0；
    条目格式有问题时**拒绝出数**（指标不可信）；
    只落在 ≤2 个面时会把 κ 标为"退化值"—— 单面装下全部条目时 κ 必然≈1.0，
    它证明的是"字典还没被检验"，与目录代理的高 κ 是同一类假信号
```

### 2.2 契约层 `packages/shared`（`K` 维 —— ✅ 已落地）

```
packages/shared/src/index.ts[K·CO·8··S]: F:契约包出口（barrel）|
  R:error-codes.ts,envelope.ts,locales.ts,permissions.ts,contract/* | A:全部公开类型与枚举 |
  S:导入路径带 `.js` 后缀是刻意的：server 用 NodeNext 要求显式扩展名，
    前端 Bundler 也接受 —— 两边同一份源码都能解析

packages/shared/src/error-codes.ts[K·CO·8··S]: F:错误码封闭枚举 |
  R:envelope.ts,apps/server/src/core/errors.ts | A:ERROR_CODES,ErrorCode |
  S:只放码。HTTP 状态映射是运行时逻辑 → 归 apps/server/src/core/errors.ts；
    后端一旦返回成品文案，切英文后错误提示就仍是中文

packages/shared/src/envelope.ts[K·CO·8··S]: F:响应信封（可辨识联合）|
  R:error-codes.ts | A:ApiOk,ApiErr,ApiResponse,Page,PageQuery |
  S:★ 用联合而非 {code,data,message}：让 TS **强制**调用方先判 ok 再取 data，
    否则会出现"成功提示里显示 undefined"；信封内禁止放文案，只有 code + 机器可读 meta

packages/shared/src/locales.ts[K·ST·8·I18N·S]: F:语种封闭枚举（≥3）|
  R:contract/products.ts | A:SUPPORTED_LOCALES,LocaleCode,LocalizedText,PUBLIC/ADMIN_DEFAULT_LOCALE |
  S:★ 这条决定**建表方式**：≥3 语种 ⇒ 必须用翻译表，不能 name_zh/name_en 两列
    （事后改要迁移全部既有数据，成本不可逆）；
    公开站默认 en、后台默认 zh 是**两个不同的默认值** —— 受众不同，混成一个两边各错一半

packages/shared/src/permissions.ts[K·AU·7·SEC·S]: F:权限点与角色 |
  R:locales.ts | A:PERMISSIONS,Permission,Role,isPermission |
  S:权限点用联合类型而非 string：拼错的权限点运行时表现为"某功能突然 403"，
    极易被误判成"前端没登录"；Role.isOwner 是**隐式全权**、不展开成权限列表 ——
    否则新增权限点时会漏补超管，症状是"超管突然失去新功能"

packages/shared/src/contract/channels.ts[K·CH·7··S]: F:购买渠道契约 |
  R:locales.ts | A:PURCHASE_PLATFORMS,PurchaseChannelLink,isPurchasePlatform |
  S:平台必须封闭枚举：自由文本会让「阿里国际站 / Alibaba / 阿里巴巴」变成三个平台 →
    前台图标缺失 + 出站点击统计碎成几十个键；
    服务端只校验 http(s) 与长度，**不猜**各平台的 URL 规则（形态各异，猜必错）

packages/shared/src/contract/products.ts[K·PD·8·I18N·S]: F:产品契约（全站核心数据外形）|
  R:channels.ts,locales.ts | A:Product,ProductListItem,ProductCategory,ProductSpec,ProductQuery |
  S:三个取舍：① 文本一律 LocalizedText，不按语种加列；② **slug 也分语种** ——
    否则两种语言共用一个 URL，等于只有一种能被索引；
    ③ 时间是 ISO8601 UTC 字符串而非 Date（Date 经 JSON 序列化会带上本地时区，
    跨机传递后时区信息丢失）；ProductListItem 故意不复用 Product ——
    列表不需要 description/specs，而它们常是全表最大的两列
```

### 2.3 应用服务 `apps/server`（✅ 已落地 —— 一个完整垂直切片）

```
apps/server/src/index.ts[E·CO·9·SEC,UTC·S]: F:进程入口（配置→连库→迁移→装配→监听）|
  R:app.ts,config.ts,db/connection.ts,db/migrations.ts | A:- |
  S:★ 迁移必须在 listen **之前**：先监听会让启动瞬间的请求打到半套表结构上，
    表现为随机 500，而"正在迁移"这个因果关系在日志里几乎看不出来；
    SIGTERM 必须处理（systemd 的默认停止信号），否则可能留下 -wal 与 502；
    启动失败必须**非零退出** —— 退出码 0 会被 systemd 当成正常结束而**不重启**

apps/server/src/app.ts[E·CO·9·SEC·S]: F:Fastify 装配与错误出口 |
  R:core/errors.ts,routes/health.ts,routes/products/index.ts | A:buildApp,AppDeps |
  S:★ trustProxy 从配置读、**默认关闭**，两个方向配错都出事：不配 → 所有访客都是 A 机 IP，
    按 IP 限流变成"限流全站"（一次爆破封掉所有人）；配 true → 客户端可伪造
    X-Forwarded-For 绕过限流；错误处理器是**唯一出口** ——
    未知异常只给 INTERNAL，原始 message 可能含 SQL/路径，不透传

apps/server/src/config.ts[E·CO·8·SEC·S]: F:环境变量解析（全仓库唯一读 process.env 处）|
  R:.env.example,app.ts,index.ts | A:loadConfig,ServerConfig |
  S:★ 相对路径按 **cwd** 解析 —— 从仓库根与从 apps/server 启动会写到两个不同的库，
    测试要隔离必须传绝对路径；端口/日志级别非法**直接抛错不回落**
    （静默回落会监听到意料之外的端口）；生产强制要求 SITE_URL，
    否则 sitemap 与 hreflang 会生成指向错误域名的绝对地址**且不报错**

apps/server/src/core/errors.ts[C·CO·8·SEC·S]: F:AppError 与 HTTP 状态映射 |
  R:app.ts | A:AppError,statusOf,toAppError |
  S:★ C 层不碰 Fastify（因此可单测），reply 转换归 app.ts；
    未知异常一律降级 INTERNAL 且不透传 message（原始信息可能含 SQL/路径 → 信息泄露）；
    message 设成 code，是为了防止有人顺手把中文文案写进去再透传给前端

apps/server/src/db/dialect.ts[D·CO·9·SQL,PG,SEC·S]: F:SQL 方言适配层（唯一允许 SQLite 专有语法处）|
  R:db/connection.ts,repositories/products/repository.ts | A:applyConnectionPragmas,nowIsoUtc,to/fromJsonColumn |
  S:★ 靠 strata-allow-dialect 豁免 portable-sql：PRAGMA 三条（WAL / 外键 / busy_timeout）；
    upsert 用 ON CONFLICT 而**不是** INSERT OR REPLACE —— 后者是 SQLite 专有且**语义不同**
    （OR REPLACE 先删冲突行再插入，会触发外键级联，是隐蔽的数据丢失源）；
    占位符 ? vs $n、LIKE vs ILIKE 是**检查器检测不到的**方言差异，只能靠评审

apps/server/src/db/connection.ts[D·CO·7·SQL·S]: F:数据库连接 |
  R:db/dialect.ts,config.ts | A:openDatabase,OpenedDatabase |
  S:用 node:sqlite（DatabaseSync）零第三方依赖，这也是 engines 锁 >=22.19.0 的原因；
    自动建目录但**不预置任何业务数据**（首次建库归迁移）；
    SQLite 单写事务 —— 多进程共库会 SQLITE_BUSY，真要水平扩展必须换 PG

apps/server/src/db/migrations.ts[D·CO·9·SQL,PG·M]: F:手写迁移（版本有序、可重复执行）|
  R:db/dialect.ts,db/connection.ts | A:MIGRATIONS,migrate |
  S:★ 主键用 TEXT(UUID) 不用 AUTOINCREMENT：后者是 SQLite 专有 + 泄漏业务量
    （URL 里 /products/17 可被枚举）+ 导入导出时整数 id 会冲突；
    ★ 多语走**翻译表**而非 name_zh/name_en —— 这是 F5.4 在建表层面的落地，代价是取名称要 JOIN；
    进翻译表 vs 进 JSON 列的判据是**是否需要被检索**（name/slug 要 → 翻译表 + 索引；
    specs 只随产品整体读 → JSON 列即可，避免为它建键值表而带来 N 倍行数）；
    每条迁移单独事务，失败即回滚该条，不留半套表结构

apps/server/src/repositories/products/mapper.ts[D·PD·8·SQL·M]: F:行 → DTO 映射 |
  R:repositories/products/repository.ts,db/dialect.ts | A:toProduct,toProductListItem,各 Row 类型 |
  S:★ 吸收三处阻抗失配：① SQLite 的 INTEGER 0/1 → boolean（PG 有真 boolean；
    前端拿到 0/1 会出"已下架却没被隐藏"）；② 多行翻译 → LocalizedText，**不做静默回落**
    （静默回落会让漏传语种表现为"显示了另一种语言"而不是报错，陷阱 P-11）；
    ③ JSON 列解析失败返回 fallback 而不抛错；渠道的**枚举外平台被丢弃**，
    而不是原样透传渲染出一个空按钮

apps/server/src/repositories/products/port.ts[D·PD·9·PG·S]: F:产品仓储**端口**（接口，与驱动无关）|
  R:repositories/products/sqlite.ts,services/products/service.ts | A:ProductRepository |
  S:★ P0.1 补上的那一半「预留 PostgreSQL」：骨架阶段只收口了 SQL 方言，
    但仓储签名直接吃 DatabaseSync —— 换 PG 时方言不用改，**每个仓储的签名与装配点却都要动**；
    抽端口后，服务层依赖 ProductRepository，换驱动 = 新增一个实现 + 改 index.ts 一行装配；
    ★ 端口里**不出现任何数据库类型**（DatabaseSync / SQLInputValue / Row 类型）——
    一旦出现，这个接口就又绑死在 SQLite 上了；行类型转换是实现内部事务（mapper.ts）；
    ★ 现在做只改 3 个签名，12 个域铺开后是几十处 —— 这是全项目唯一"成本随时间线性增长"的任务

apps/server/src/repositories/products/sqlite.ts[D·PD·9·SQL,PG,PERF·M]: F:产品仓储的 SQLite 实现（SQL 只在此层与 db/）|
  R:repositories/products/port.ts,repositories/products/mapper.ts,db/dialect.ts |
  A:createSqliteProductRepository |
  S:★ 列表取**全部语种**的翻译而不只是请求语种 —— hreflang 需要每个语种的 slug，
    只取请求语种则构建期生成不出互指链接，而互指错了搜索引擎会判重复内容；
    ★ 多次查询而非一次多表 JOIN：JOIN N图×M渠道×K规格会行倍增，产品一多列表耗时随图数增长；
    ★ LIKE 的 % / _ / \ 必须转义，否则访客搜一个 % 就等于匹配全表；
    node:sqlite 的 double-cast 收口在 queryAll / queryOne 两个函数里；
    ⚠ 本文件的 SQL 是可移植的（portable-sql 守着），但**两处方言差异检查器检测不到**：
    占位符 `?` vs `$1`、以及 `LIKE` 在 PG 下大小写敏感（需换 ILIKE）—— 只能靠评审

apps/server/src/services/products/service.ts[S·PD·8·SEC·S]: F:产品应用服务（编排 + 访问策略）|
  R:core/errors.ts,repositories/products/repository.ts | A:requireLocale,listPublicProducts,getPublicProduct |
  S:★ 公开与后台**走不同入口**：listPublicProducts 强制 publishedOnly=true ——
    策略由服务端定、不由入参定，否则前端加个 ?publishedOnly=false 未上架产品就露出去；
    ★ 未上架详情返回 **404 而非 403**：403 等于确认"id 存在但你看不到"，
    把未发布清单泄漏了出去；语种非法 → BAD_REQUEST，不静默回落

apps/server/src/routes/health.ts[R·CO·7··S]: F:健康检查 |
  R:app.ts,db/dialect.ts | A:registerHealthRoutes,HealthPayload |
  S:★ 必须回报**依赖的真实状态**（库路径 + 已应用迁移数），不能恒定 {"status":"ok"}：
    否则"目录写不进去""迁移没跑完"会被反代与 systemd 当成健康，请求转进来后才逐个失败 ——
    那时错误分散在业务接口上，排查方向完全不同；不回报任何凭据或完整环境变量

apps/server/src/routes/products/handlers.ts[R·PD·7·SEC·S]: F:产品路由处理函数 |
  R:services/products/service.ts,core/errors.ts | A:createProductHandlers |
  S:R 层只做三件事：校验入参格式、调服务、套信封 —— 不放业务规则，也不放 SQL；
    入参非法**直接 400**，不做 Math.max 之类静默纠正（静默纠正会让调用方以为分页生效了）；
    不写 try/catch，否则每个处理函数都要重复一遍错误映射（统一在 app.ts 的错误处理器）

apps/server/src/routes/products/index.ts[R·PD·7··S]: F:产品路由注册 |
  R:routes/products/handlers.ts | A:registerProductRoutes |
  S:★ API 路径**不带语种**，语种走 querystring：页面 URL 的语种前缀是给搜索引擎分语种收录的，
    而 API 的 locale 是内容协商 —— 把语种塞进 API 路径只会让缓存键按语种翻倍，
    接口本身并不因语种而不同；Fastify 的 radix 树能区分 /products 与 /products/:id，
    **不存在** nginx 那种前缀 location 吃掉真实路由的问题（P-07 是 nginx 侧的陷阱）
```

### 2.4 前台 `apps/web`（✅ SSG 已跑通 —— P0.3 spike 的产物）

```
apps/web/vite.config.ts[E·CO·7·SSG·S]: F:Vite 配置（客户端与 SSR 共用）|
  R:apps/web/scripts/prerender.mjs,apps/web/tsconfig.json | A:- |
  S:★ 客户端与 SSR 用**同一份配置**，靠 CLI 的 --ssr 与 --outDir 区分；
    两次构建的 outDir 必须不同，且 **SSR 那次不能 emptyOutDir** ——
    否则第二次构建会把刚产出的客户端产物删掉，症状很像"构建顺序错了"

apps/web/src/env.d.ts[E·CO·3··S]: F:`*.vue` 模块形状声明 |
  R:apps/web/tsconfig.json | A:- |
  S:只为让 `tsc --noEmit` 能解析 .vue 导入；**真正的 SFC 类型检查要靠 vue-tsc**（P1 引入）。
    没有它，每个 .vue 导入都会报 TS2307

apps/web/src/main.ts[E·CO·8·SSG,SEC·S]: F:客户端入口（在预渲染 HTML 上水合）|
  R:apps/web/src/app.ts,apps/web/src/site-context.ts | A:- |
  S:★ **不能用顶层 await** —— Vite 默认构建目标（es2020）不支持，会直接构建失败
    （`Top-level await is not available in the configured target environment`）。
    解法是包成 async 函数而不是提高 build.target：为一个语法糖把整站兼容性门槛
    抬到 ES2022 不划算，而外贸站访客的浏览器分布很杂；
    硬约束 runtime-config 在此落地：站点数据来自 window.__APP_DATA__（运行时），
    不是 import.meta.env（构建期）；缺这份数据要**明确报错**，不能静默降级渲染空白页

apps/web/src/entry-server.ts[E·CO·8·SSG,SEO·S]: F:SSR 入口 + head 生成 |
  R:apps/web/src/seo/urls.ts,apps/web/scripts/prerender.mjs | A:renderPage,re-export 路径与文案工具 |
  S:★ 把 SEO 片段放在 SSR 侧而不是让预渲染脚本自己拼，是为了让 hreflang / canonical /
    <html lang> **三者永远同源** —— 分头计算时最常见的 bug 是 hreflang 写 zh-Hans
    而 html lang 还写着 zh；
    ★ 返回值带 `routeName`：预渲染脚本据此断言路由真的匹配上了（见 P-16 陷阱）

apps/web/src/app.ts[E·CO·8·SSG·S]: F:应用工厂（SSR 与客户端共用）|
  R:apps/web/src/router.ts,apps/web/src/site-context.ts | A:createApp |
  S:★ 两端**必须**复用同一个 createApp：各建一套会让组件树 / provide / 路由表漂移，
    而漂移的症状是水合失败 —— 页面看起来正常，交互却失效

apps/web/src/router.ts[X·CO·8·SEO·S]: F:路由表与 URL 结构（**决策 2**）|
  R:apps/web/src/seo/urls.ts,apps/web/src/pages/ | A:routes,createAppRouter,DEFAULT_HOME_PATH |
  S:★ URL 前缀选 `/<locale>/...` 而不是子域名：一份 TLS 证书 + 一套 nginx 配置 +
    域名权重集中在一个域（新站起步阶段这点重要）；代价是 `/` 需要一次跳转；
    `strict: true` 保留尾斜杠差异 —— `/en` 与 `/en/` 不做自动归一，避免产生两个可索引地址；
    历史模式由调用方注入（SSR 用 memory、浏览器用 web），保证两端路由一致

apps/web/src/site-context.ts[X·UI·7·SSG·S]: F:站点上下文（provide/inject）|
  R:apps/web/src/app.ts,apps/web/src/i18n/messages.ts | A:SiteContext,SITE_CONTEXT,useSite |
  S:★ **不用模块级可变状态**：SSR 在同一进程里顺序渲染多个页面，模块级状态会跨渲染泄漏
    （上一个页面的产品串到下一个页面），症状是"偶发出现别的产品名"，极难复现；
    provide/inject 的生命周期绑在 app 实例上，天然没有这个问题

apps/web/src/i18n/messages.ts[N·ST·5·I18N·S]: F:界面文案（最小静态映射）|
  R:apps/web/src/site-context.ts | A:MESSAGES,messagesFor |
  S:spike 阶段不强引 vue-i18n（要验证的是预渲染管线，不是 i18n 库选型）；
    P1.2 会换成按域拆分的资源文件，但**组件里的调用形态不变**（始终是 messages.xxx），
    所以替换成本被限制在这一个文件；
    ⚠ 文案键在各语种间必须齐平 —— 缺键的症状是页面上显示键名本身

apps/web/src/seo/urls.ts[X·ST·9·SEO,I18N·S]: F:URL 结构 与 hreflang 互指（**决策 2 落点**）|
  R:apps/web/src/router.ts,apps/web/src/entry-server.ts,packages/shared/src/locales.ts |
  A:HREFLANG_TAGS,homePath,productListPath,productDetailPath,absoluteUrl,seoHead,htmlLang |
  S:★ 单独成文件是因为 URL 结构是**对外公开契约**，一旦被收录再改就是丢排名 ——
    收在一处才能让"改 URL 结构"成为一次可审计的改动，而不是几十处字符串替换；
    ★ `hreflang` 值**不等于** URL 前缀：URL 用短码 `/zh/` 保持可读，而 hreflang 要符合
    ISO 639-1（+可选 script/region）—— **简繁是不同内容**，只写 `zh` 搜索引擎无法区分，
    故映射为 `zh-Hans`；
    ★ 必须有 `x-default`：它是语言定向不匹配时的兜底入口，漏了会让这部分访客落到
    搜索引擎随机选中的语种页面上

apps/web/src/App.vue[O·UI·7·SEO,I18N·S]: F:站点外壳（导航 + 语言切换 + RouterView）|
  R:apps/web/src/site-context.ts,apps/web/src/seo/urls.ts | A:- |
  S:★ 语言切换用普通 `<a>` 而**不走前端路由**：静态站点上这只是一次廉价的整页加载，
    却换来两个好处 —— 不引入客户端语言状态（少一处水合不一致的来源），
    且每个语种都有独立 URL；
    切换链接缺失的语种回退到该语种首页，**不能指向"该页在那种语言下不存在"的地址** ——
    那会产生软 404，而软 404 会被搜索引擎记为低质量页面

apps/web/src/pages/[V·UI·7·SEO·S]: F:页面（首页 / 列表 / 详情 / 404）|
  R:apps/web/src/site-context.ts,apps/web/src/seo/urls.ts | A:各页面组件 |
  S:★ **目录条目**：新增一个页面不需要新条目；
    ⚠ 这一组页面实际横跨 `CT`（首页）/ `PD`（列表与详情）/ `UI`（404）三个域，
    但目录条目只能填**一个**坐标 —— 这是面模型对目录条目的固有限制。
    取 `UI` 是因为该组的共同约束（SEO、文案不硬编码）属于前端壳的范畴；
    **需要按域分开约束时，就不要用目录条目，改为逐文件写**；
    列表页取当前语种 slug 时回退到 id —— 那是下策（`/en/products/p-123` 对搜索引擎
    没有信息量），正常运营下每个产品都应有各语种 slug；
    详情页的出站链接一律 target="_blank" + rel="noopener noreferrer"
    （缺 noreferrer 会把含内部标识的来源 URL 交给第三方）

apps/web/scripts/prerender.mjs[T·SC·9·SSG,SEO,PERF·M]: F:构建期预渲染（SSG 核心）|
  R:apps/web/src/entry-server.ts,apps/server/src/routes/products/ | A:- |
  S:★ **必须翻页取产品**：服务端 MAX_PAGE_SIZE=60，只取第一页会让产品超过 60 个时
    构建"成功"但站点静默缺页 —— SSG 特有的一类静默失败；
    ★ 每个产出页都断言 `routeName` 是预期值：URL 拼错会落到 not-found，
    而预渲染**照样写出 HTML**，于是构建出一整站 404 页面且会被搜索引擎收录；
    ★ 详情页必须走 GET /api/products/:id 取**完整 Product** —— 列表接口返回的是
    ProductListItem，它故意不含 specs/description/mediaIds（spike 就是这么撞上的），
    跨 JSON 边界 TS 类型不生效，所以还有一次运行时形状断言；
    ★ 某语种缺翻译时**不产出该语种页面、也不在 hreflang 里宣告它**（软 404 + 重复内容）；
    ★ 水合数据序列化时把 `<` 转成 \u003c —— JSON 里出现 </script> 会提前结束脚本标签；
    ★ 构建依赖**运行中的 API**，所以它不能放进无条件的构建链（见根 package.json 的 build）
```

### 2.5 测试（`tests/`）

```
tests/[T·SC·7·SEC·S]: F:测试基线（单测 + 端到端回归）|
  R:strata/constraints.mjs,package.json | A:各 *.test.mjs |
  S:★ **目录条目**：新增测试文件不需要新条目；
    跑的是**构建产物**（apps/server/dist），不是源码 —— 改了源码要先 pnpm build，
    否则跑的是旧行为（陷阱 P-02）；子进程一律**不用管道**（stdio 给文件描述符），
    受限环境下管道捕获子进程输出会失败；
    SSG 回归会真的跑一次 Vite 构建（约 15s），换来的是**公开 URL 结构**有自动化守卫 ——
    那是最贵、最不可逆的契约；
    ⚠ 两个端到端测试各带一段"起服务+灌数据"，**出现第三个时就该抽 tests/lib/harness.mjs**
```

### 2.6 后台与运营能力（✅ 本轮落地 —— 登录 / 产品管理 / 图片上传）

```
packages/shared/src/contract/auth.ts[K·AU·8·SEC·S]: F:后台账号契约 |
  R:permissions.ts | A:AdminUser,LoginInput,LoginResult |
  S:★ 这里**绝不能**出现 password_hash / salt —— 契约是前后端共享的，
    一旦定义，某个接口迟早会把它序列化出去，而那是一次不会有测试失败的静默泄露；
    凭据材料只存在于 repositories/auth/port.ts 的 AuthUserRecord 里

packages/shared/src/contract/media.ts[K·MD·7··S]: F:媒体契约 |
  R:contract/products.ts | A:MediaAsset |
  S:★ `url` 是**相对路径**（`/media/<id>`）而不是绝对地址：站点与 API 同源反代，
    两种环境都对；若返回绝对 URL 就得把域名写进库，换域名时历史图片地址全部失效

> `contract/products.ts` 的条目在 §2.2（本轮为它补了 `coverMediaId`，见该条目的说明）。

apps/server/src/core/[C·AU·8·SEC·S]: F:安全与请求上下文（口令 / 令牌 / 限流 / 认证守卫）|
  R:services/auth/service.ts,db/migrations.ts | A:hashPassword,verifyPassword,createSessionToken,createLoginRateLimiter,requireAdmin |
  S:★ **目录条目**（覆盖 passwords / tokens / rate-limit / auth-context；errors.ts 有条目）；
    用 **scrypt + timingSafeEqual**，口令先做 NFKC 归一（全角/半角不同码位会让"输对了登不上"）；
    用户不存在时**照样跑一次 scrypt**，否则响应时间会暴露用户名是否存在；
    ★ **会话表而不是 JWT**：JWT 无法注销，而"退出登录要真的失效"是后台的硬要求，
    还省掉签名密钥的生成/保管/轮换；令牌**只存 sha256**，库泄露也拿不到可用令牌；
    ★ 登录限流是**内存实现**：进程重启即清零、多实例不共享（单机够用，扩展时必须换共享存储）；
    限流键是 `IP+用户名` —— 只按 IP 会连坐同一出口的整个办公室，只按用户名则挡不住撒网

apps/server/src/repositories/auth/[D·AU·9·SQL,SEC·M]: F:账号与会话仓储（port + sqlite）|
  R:core/passwords.ts,core/tokens.ts | A:AuthRepository,createSqliteAuthRepository |
  S:★ **目录条目**；`username` 的 UNIQUE 交给数据库而不是应用层"先查再插" ——
    并发时后者会漏，而漏的症状是"登录匹配到哪一条全靠运气"；
    权限点解析时**丢弃枚举外的值**（库里的废弃权限点既不该出现在勾选界面，更不该放行）；
    SQLite 的 INTEGER 0/1 → boolean 的转换收口在 toRecord

apps/server/src/repositories/audit/[D·AL·8·SQL·S]: F:审计仓储（port + sqlite）|
  R:db/migrations.ts | A:AuditRepository,createSqliteAuditRepository |
  S:★ **「只追加」写在类型里**：端口只有 append / recent，没有 update / delete ——
    于是 `append-only-audit` 约束不必靠检查器扫"有没有人写了 UPDATE"，调用方根本拿不到那个能力。
    "让错误不可能发生"优于"让错误被发现"；
    actor_id **故意不加外键**：用户删除后审计必须留存，否则"谁删的"会随用户一起消失；
    审计写失败只记日志、不让业务失败（需要强一致时两者应同事务 —— 见文件头取舍）

apps/server/src/repositories/media/[D·MD·8·SQL,PG·S]: F:媒体仓储（port + sqlite）|
  R:db/migrations.ts | A:MediaRepository,createSqliteMediaRepository |
  S:★ 磁盘文件名按 `<id><扩展名>` 由 **mime 反查**得出，**没有 stored_name 列** ——
    映射表稳定（image/jpeg→.jpg 不会变），所以可确定性重建；
    原始文件名只存库用于展示，**永不参与路径拼装**（目录穿越的经典入口）；
    countReferences 把封面引用与图集引用**分别数再相加**，用 UNION 会丢掉这个区分；
    ⚠ 本域 SQL 与 PG 的差异：SQLite 用 INTEGER 存布尔、PG 用真 boolean

apps/server/src/services/auth/service.ts[S·AU·9·SEC·M]: F:认证服务（登录 / 会话 / 权限断言）|
  R:core/passwords.ts,core/tokens.ts,core/rate-limit.ts,repositories/auth/port.ts | A:createAuthService,toAdminUser,assertPermission |
  S:★ 登录失败**三种原因返回同一个错误**（用户不存在 / 口令错 / 已停用），
    区分开就等于送攻击者一个用户名枚举接口；真实原因只写进审计；
    ★ 过期判定**只在这一处** —— 分散判过期最常见的后果是某个入口忘了判；
    账号停用后立刻清掉其手上未过期的会话；
    `isOwner` 隐式全权直接放行，不看 permissions 列表（否则每加一个权限点都要回头补超管）

apps/server/src/services/media/service.ts[S·MD·8·SEC·S]: F:媒体服务（校验 / 落盘 / 引用保护）|
  R:repositories/media/port.ts,db/dialect.ts | A:createMediaService,MAX_UPLOAD_BYTES |
  S:★ mime 白名单**不含 SVG** —— SVG 可内嵌脚本，同源提供就是存储型 XSS 的载体，
    而这是"上传图片"最容易漏的一条；
    ★ 先落盘再写库，写库失败则删掉已落盘文件（否则积攒无主文件）；
    ★ 删除前查引用计数，有引用返回 409 —— 否则前台产品页出现破图，
    看起来像"图片丢了"而不像"有人在媒体库删了东西"；
    ⚠ 已知缺口：不压缩、不生成缩略图、width/height 恒为 null（需图像库）

apps/server/src/services/products/admin.ts[S·PD·9·SEC·M]: F:产品的后台服务（校验 / 写入 / 审计）|
  R:services/products/service.ts,repositories/products/port.ts,repositories/audit/port.ts | A:createProductAdminService,validateProductInput |
  S:★ 与 service.ts（公开读路径）**分开**：两者的访问策略正好相反，混在一起最容易
    发生"某天公开接口复用了后台的某个函数"；
    ★ slug 冲突检查**与写入同事务** —— 分开做则两个并发请求都能通过检查，
    而按语种唯一的索引会让第二个以一个跟"slug 重复"毫无关系的数据库错误失败；
    slug 限制为小写/数字/连字符：它会直接进 URL，含中文的 slug 会被编码成不可读形式；
    媒体存在性靠**注入的 mediaExists** 而不是直接依赖媒体仓储，避免 PD 与 MD 互相耦合

apps/server/src/routes/auth.ts[R·AU·8·SEC·S]: F:认证路由（登录 / 登出 / 当前用户）|
  R:services/auth/service.ts,core/auth-context.ts | A:registerAuthRoutes |
  S:限流触发返回 **429 而不是 401** —— 否则前端显示"口令错误"，
    用户会继续改口令重试，把锁定期一次次刷新；
    登出**幂等**：令牌本来就无效也返回成功（前端的期望是"我登出了"）；
    `request.ip` 的取值取决于 trustProxy，没配反向代理时会拿到 A 机 IP 并让限流退化成"限流全站"

apps/server/src/routes/media.ts[R·MD·8·SEC,PERF·S]: F:公开媒体服务（GET /media/:id）|
  R:services/media/service.ts | A:registerPublicMediaRoutes |
  S:★ 由应用按 id 提供而不是让 nginx 读磁盘：nginx 在 A 机、文件在 B 机；
    且按 id 提供为将来的访问控制留了口子；
    `Cache-Control: immutable` 是**安全的**，因为每次上传都生成新 id（id 与内容一一对应）——
    ⚠ 若将来允许"替换某个 id 的文件内容"，这条缓存策略必须同时改掉，否则用户永远看到旧图；
    带 X-Content-Type-Options: nosniff；库里有记录但磁盘无文件时返回 404 而非 500

apps/server/src/routes/admin/[R·PD·8·SEC·M]: F:后台路由（产品 + 媒体管理）|
  R:core/auth-context.ts,services/products/admin.ts,services/media/service.ts | A:registerAdminProductRoutes,registerAdminMediaRoutes |
  S:★ **目录条目**（覆盖 products.ts 与 media.ts，两者同属后台管理面）；
    权限点分开（product:read/write/publish、media:read/write/delete），
    不共用一个"管理员"开关 —— 否则"能改文案但不能上架"这种真实需求无法表达；
    ★ 上传用**裸请求体**而不是 multipart：单文件不需要它，且避开了部件顺序、
    limits 配置、首部文件名转义等一批已知陷阱；类型白名单在 app.ts 的
    addContentTypeParser 与 media 服务里**各拦一次**（只拦一处时，改错任一处都会让另一处形同虚设）；
    ★ 路由泛型必须写在方法上（`app.get<{...}>()`）：写在 handler 参数上 TS 无法反推，
    会报 "RouteGenericInterface 不可赋值"

apps/admin/[X·AU·7·SEC,I18N·M]: F:后台 SPA（登录 / 产品列表 / 产品编辑 / 图片上传）|
  R:apps/server/src/routes/admin/,packages/shared/src/contract/ | A:- |
  S:★ **目录条目**，覆盖全部后台源码（含 vite.config.ts —— 它的坐标本该是 E·CO，
    但目录条目只能填一个坐标，这里取 UI 面；需要按文件分域约束时应改为逐文件条目）；
    ★ `vite.config.ts` 的 `base: '/admin/'` 必须与 nginx 的 location 三者一致 ——
    不一致时资源请求落到前台站点，浏览器报 `Unexpected token '<'`（把 HTML 当 JS 解析），
    极易被误判成"构建坏了"；
    ★ `api.ts` 是唯一发请求的地方：解信封、错误码→文案、401 自动清会话并跳登录；
    ★ `session.ts` 用 localStorage 存令牌（Bearer 头天然免疫 CSRF），
    代价是 XSS 可窃取 —— 缓解措施是不用 SVG 上传白名单 + Vue 默认转义 + nosniff，
    要更强需改 HttpOnly Cookie + CSRF token；
    ★ `product-form.ts` 承担 Product（读）↔ ProductInput（写）的转换：
    两种形状不同，直接回传读到的对象会静默清空翻译字段；
    ★ 语言切换/列表显式标出"缺哪个语种"：只看一种语言时最容易"英文录了中文忘了"

apps/server/src/cli/create-admin.ts[T·AU·8·SEC·S]: F:建/重置后台管理员（编译进 dist/cli/，发布包可用）|
  R:core/passwords.ts,db/migrations.ts,db/dialect.ts | A:- |
  S:★ 放在 **server 包内**而不是仓库根的 scripts/ —— 根脚本用相对路径
    import `apps/server/dist/...`，**只在仓库布局下成立**；发布包里只有 dist/，那个路径不存在。
    放进 dist 后，仓库布局与发布布局用同一份实现，不存在两处逻辑漂移；
    ★ **不预置默认账号**（`admin/admin123` 等于给每个忘了改口令的部署留后门，而"忘了改"是常态）；
    第一个账号强制全权（否则没人能再授权，系统锁死）；
    ★ 重置口令时**必须清掉该账号全部会话** —— 用户改口令的动机往往正是"怀疑令牌泄露了"；
    直接跑迁移，允许在服务首次启动前就把账号建好

scripts/publish-site.sh[T·SC·8·SEC·S]: F:一键发布站点到 A 机（在 B 机上执行）|
  R:deploy/nginx.conf,docs/部署说明.md,apps/web/scripts/prerender.mjs | A:- |
  S:★ 存在的理由是**顺序不能反**：前台是 SSG，页面由构建期从 API 拉数据生成，
    必须先重建再传；反过来传上去的还是旧页面。脚本把顺序固定住，省掉"少跑一步"；
    ★ rsync 源路径**结尾的斜杠至关重要**：`src/dir/` 传的是目录**内容**，
    漏了斜杠会多出一层 `dir/`，症状是"文件明明传上去了但 nginx 404"；
    ★ 前置检查用 `ssh -o BatchMode=yes` 先探一次免密登录 ——
    否则 rsync 会在中途停下来问密码，无人值守时就卡死在那里；
    缺 rsync 时直接给出 Debian/RHEL 的安装命令，而不是让后续步骤含糊地失败；
    ★ 发布后**真的去 A 机取一次 sitemap 并比对页面数**：不验证的发布等于没发布 ——
    文件可能落错目录、nginx 可能指向旧 root、中间可能隔着缓存，
    这三种情况的共同点是**本地看起来完全正常**；
    ★ `--no-build` 只重传（仅改了后台代码时用），`--dry-run` 先看会传什么

scripts/release.mjs[T·SC·9··M]: F:生产发布打包（本机构建 → 自包含产物 → 上传）|
  R:apps/server/package.json,packages/shared/package.json,deploy/ | A:- |
  S:★ 存在的理由：本机 `node_modules` **不能**传到 Linux ——
    pnpm 子包 node_modules 里全是符号链接，真包在根 .pnpm；且 Windows 的链接是绝对路径，换机即断。
    所以装配出**不依赖 pnpm 布局**的产物：server/dist + 把 shared 的 dist 当本地包
    （`file:./shared`），服务器上 `npm install --omit=dev`（fastify 是纯 JS，无需编译）；
    ★ `packages/shared` 必须随包 —— 编译产物**运行时确实 import 它**（grep 确认 4 处）；
    ★ `API_BASE` 必须指向**目标环境的** API：指向本机开发服务的话，
    静态页里是本地产品，传到服务器后内容与库对不上**且不报错**；
    ★ 禁止名单**只放"任何位置都不可能合法"的名字**，不能按 `data` 这类通用名排除 ——
    服务端 dist 里有合法的 `dist/data/` 模块目录，按名排除会直接打坏包（家族事故教训）；
    跳过闸门用 --skip-gates（不推荐，仅紧急热修）

scripts/create-admin.mjs[T·SC·5·SEC·S]: F:仓库布局下的建管理员包装 |
  R:apps/server/src/cli/create-admin.ts | A:- |
  S:★ **薄包装，不含实现** —— 口令摘要算法只应该有一处代码，
    两处分叉的症状是"用某个入口建的账号登不进去"，而排查会一路查到登录逻辑；
    找不到 dist 时明确提示"先 pnpm build"并给出发布包布局下的替代命令

docs/部署说明.md[T·SC·8·SEC·M]: F:部署说明（两台内网机器：A 172.19.3.47 / B 172.19.229.191）|
  R:deploy/nginx.conf,deploy/env.production.example,deploy/oenpc-web-server.service | A:- |
  S:★ **`OENPC_WEB_HOST` 必须填 B 机的内网地址，不能是 `127.0.0.1`** ——
    A 机是另一台主机，连不上 B 的回环地址。这条已实测：绑到具体地址后，
    同一进程从 `127.0.0.1` 访问**连不上**（不是"可能有问题"，是必然）；
    填错时的症状是"本机 curl 正常、A 机一律 502"，而 502 通常被误判成"应用挂了"；
    ★ 连带后果：因为服务不在回环上，**在 B 机上自检与构建前台都要用内网地址**
    （`OENPC_WEB_API_BASE=http://172.19.229.191:3900`）；
    ★ 源码与构建都在 B 机（A 机只需 nginx），产物再 rsync 到 A；
    ★ 顺序有硬要求：前台是 SSG，**先起后端 → 录内容 → 再 build:web**；
    ★ `SITE_URL` 是**构建期烧进 HTML** 的（canonical/hreflang/sitemap 都用它生成绝对地址）——
    绑域名时只改 .env 与 nginx 而不重建，页面仍指向旧地址且不报错，会被判重复内容；
    §9 说明当前是**内网明文 HTTP**，口令与令牌在 A→B 之间明文传输，不可映射公网；
    §10 备份必须**库与媒体一起备**且用 sqlite3 的 .backup（直接 cp 正在写的库会损坏）；
    §11 升级 rsync 必须 --exclude data --exclude .env，漏了覆盖数据库与配置；
    末尾列了本轮**没做**的部分，避免把功能清单的 ✅（需求已确认）误读成"已实现"
```

### 2.7 待建（骨架未覆盖的部分）

> 这些面目前还没有条目 —— **新文件落在已有面上时不需要新约束**（锚定的收益），
> 只有出现**新的面**时才需要新增规则。

```
apps/admin/src/**      [V/O/X/N·AU,PD,CT,IQ,…·…] 后台 SPA（尚未创建）
apps/server/src/routes/<其他域>        [R·<域>·…]
apps/server/src/repositories/<其他域>   [D·<域>·…]
apps/server/src/db/（媒体 / 询盘 / 审计表）  [D·<域>·…]
apps/web/src/components/               [O·UI,PD·…]（前台目前只有页面，尚无独立组件）
apps/web/src/api/                      [X·CO·…]（运行时配置读取，尚未实现）
```

> **条目粒度不是"每个文件一条"**（`reference.md` §4.4）：
> 一个文件值得单独成条 ⇔ 它承担了**别的文件会误用的设计决策**，
> 或它的改动**会波及他处**；否则并入所属模块的条目，或直接用**目录条目**。
> **依据是"有无非显然的约束"，不是文件大小** ——
> 一个 11 行的文件如果有个坑，比一个 500 行的样板文件更该有条目。

---

## 3. 关键依赖拓扑

```
E ──► R ──► S ──► D        （服务端单向依赖，禁止反向）
              └──► C ──► D
V ──► X ──► R（HTTP）
V ──► O
V/O/X ──► N                （所有前端层都可读 locale）
V/O/X/R/S/D ──► packages/shared   （契约，全层可读）
```

**不变量**：

- **`C` 不依赖任何框架**（不 import `fastify`、不碰 `req`/`reply`）。
  这是"领域逻辑可单测"的前提，也是 `C` 与 `S` 的分界线。
- **`D` 不被 `R` 直接依赖** —— 路由只经 `S`（或 `C`）访问数据。
- **`shared` 只放类型，不放运行时逻辑**。

> `R` 只到文件名级，**不做函数级调用链**；需要精确调用链时仍需读源码。

---

## 4. 高频陷阱

> **本节是 `V`（判决）层的需求来源**：每条陷阱都应当有一个**可执行**的检查形态。
> 写不出来的，说明它目前只能靠人读 —— 按 STRATA 的实验假设，它大概率不会生效。
>
> **来源标记**：[实测] = 在 OENPC 家族项目上真实踩过（迁移自 `oenpcv3.1/AGENTS.md` 与
> 起源案例索引）；[结构] = 由本项目的技术选型必然推出，尚未踩但确定会发生。

| # | 陷阱 | 触发条件 | 规避 | 检查形态 | 来源 |
|---|---|---|---|---|---|
| P-01 | **模板字面量内注释含反引号** | 用模板字面量拼 HTML/JS 时，注释里出现反引号 → 模板提前结束，或 `.foo` 被解析成 `${foo}` | 需要强调时用「」或直接写类名 | 让 **Node 解析器**判定，**不要手写词法扫描**（手写扫描器会漏报：反引号成对时它报"干净"，解析器能报出真问题）| [实测] 5 次 |
| P-02 | **回归跑的是构建产物，不是源码** | 改了源码没重新构建就跑回归 → 旧行为，症状误导（曾表现为"一连串 415/404，看起来像代码写错"）| 改源码先构建再回归；`git stash` 后干净树上跑一次以区分"我的改动有问题"与"产物陈旧" | 回归脚本启动前校验产物 mtime 晚于源码 | [实测] |
| P-03 | **整段替换代码时静默删功能** | 用脚本整段替换渲染/脚本代码 → 页面能打开、功能没了（曾把画廊键盘处理整个删掉）| 整段替换后**必须**跑回归，别只看页面能否打开；检查是否漏分支 | 替换后跑回归 | [实测] |
| P-04 | **断言匹配到非渲染区域** | 页面有 `<script>`/`<style>`，全文 `includes` 会命中其中的类名/选择器名 → 页面是坏的断言却通过 | 断言只作用在渲染区域；**按元素定位**而不是"取第一个匹配"；切片锚点用 `<script>` 这类稳定标记，**别用变量名** | 断言辅助函数强制切片 | [实测] |
| P-05 | **nginx `client_max_body_size` 默认只有 1m** | 任何上传都先在 nginx 被 413 拦掉，**根本到不了应用** | 在 nginx 侧显式放开上传路径 | 检查 nginx 配置片段 | [实测] |
| P-06 | **SSE 被 nginx 缓冲** | 未设 `proxy_buffering off` → 前端"连上了但收不到事件"，表现为实时功能完全不工作 | SSE location 必须 `proxy_buffering off` + 放宽 `proxy_read_timeout` | 检查 nginx 配置片段 | [结构] |
| P-07 | **SPA 回落吃掉真实路由** | `try_files $uri /index.html` 会把 `/api/xxx`、`/events` 吃掉 → 前端拿到 HTML 而不是 JSON/事件流 | 用 `^~` 前缀 location 让 `/api/`、`/events/` **优先于** SPA 回落；后台回落到 `app.html` 而不是前台 `index.html` | 检查 nginx location 顺序 | [实测] |
| P-08 | **SSG 产物与后台数据不同步** | 后台改了产品，前台静态页还是旧的 → 运营者以为"保存没生效" | 明确重建触发方式（本期手动/定时），并在后台给出提示 | 后台保存后检查是否触发重建 | [结构] |
| P-09 | **单租户假设写死在唯一键里** | 本期单租户，但"通用型"可能演进到多站点；若把 `settings` 设计成"全局只有一行"，演进时要改表与全部读取点 | 唯一键设计不要假设"全局唯一"，给站点维度留余地 | 人工评审（不可判定 → exit 2）| [结构] |
| P-10 | **多语言文案键不同步** | 加了一个键只写了 `zh` 没写 `en` → 线上显示 `product.detail.title` 这种键名 | 语种键做**集合一致性检查**，缺键即失败 | 对比各 locale 资源的键集合 | [结构] |
| P-11 | **翻译表关联漏传语种** | 查询产品时忘了按语种关联翻译表 → 前台静默回落到默认语种，**不报错** | 语种作为**必填**参数贯穿查询；不允许默认值兜底 | 仓储层签名检查 | [结构] |
| P-12 | **SQLite 无原生 datetime 类型** | 时间存成不同格式的字符串 → 排序与区间查询结果错乱 | 统一 ISO8601 UTC 字符串格式，由一处工具函数产出 | 检查时间格式化调用点 | [结构] |
| P-13 | **`node:sqlite` 并发写锁** | 多进程/多连接同时写 → `SQLITE_BUSY` | 单进程写入；开 WAL；写事务短小 | 检查 PRAGMA 设置 | [结构] |
| P-14 | **图片删除后前台 404** | 媒体库删了仍被产品引用的图片 | 引用计数 + 删除保护 | 删除前检查引用 | [结构] |
| P-15 | **面对称性：两个 app 的入口落在同一个面上** | 前后端各有入口（`apps/server/src/index.ts` 与 `apps/web/src/main.ts`），**两者坐标都是 `⟨E,CO⟩`** —— 面无法区分"服务端入口"与"站点入口"，于是锚在 `⟨E,CO⟩` 的约束会同时命中两侧 | 只适用于一侧的约束，锚在**关注点真正所在的层**（如 API 客户端层 `X`），**不要锚在入口层 `E`**；确需覆盖 `E` 时必须确认该规则在两侧都成立 | 人工评审（不可判定 → exit 2）| [实测] 骨架落地时发现 |
| P-16 | **预渲染会为"路由没匹配上"的 URL 照样写出 HTML** | 某个 URL 拼错 → 路由落到 `not-found` → 预渲染**照样产出该路径的 HTML**。于是构建"成功"，但产出一整站的 404 页面，而且搜索引擎会把它们全部收录。本地看目录结构一切正常 | 每个产出页都断言实际匹配到的路由名是**预期值**，不匹配即中止构建（`prerender.mjs` 已实现）| 构建期断言（已在 `prerender.mjs` 里）| [实测] spike 设计时预见 |
| P-17 | **Vite 默认构建目标不支持顶层 await** | 客户端入口写了顶层 `await` → 构建直接失败：`Top-level await is not available in the configured target environment` | 包成 async 函数（推荐）或提高 `build.target` 到 `esnext`。**为一个语法糖把整站兼容性门槛抬到 ES2022 不划算** —— 外贸站访客的浏览器分布很杂 | 构建（失败即暴露）| [实测] P0.3 |
| P-18 | **列表形状 ≠ 详情形状，跨 JSON 边界 TS 类型不生效** | 用列表接口返回的 `ProductListItem` 去渲染详情页 → 缺 `specs`/`description`/`mediaIds`，SSR 渲染到一半抛 `Cannot read properties of undefined`，栈里全是 Vue 内部帧 | 详情页必须走 `GET /api/products/:id` 取完整 `Product`；**在数据边界处做一次运行时形状断言**，让报错直接说清缺哪个字段 | 构建期形状断言（已在 `prerender.mjs` 里）| [实测] P0.3 撞上 |
| P-19 | **SSG 构建依赖运行中的 API** | 预渲染要从 API 拉数据 → 构建机必须有可用的后端。若把 web 的构建放进无条件构建链（`pnpm -r build`），**没有后端时整条链都会失败** | 根 `package.json` 的 `build` 只构建 shared + server；web 的构建单独一条命令（`build:web`），由部署脚本或 CI 负责先起后端 | 根 `package.json` 的脚本划分 | [实测] P0.3 |
| P-20 | **构建期只取一页产品 = 站点静默缺页** | 服务端 `MAX_PAGE_SIZE = 60`。预渲染只取第一页时，产品超过 60 个后**构建照样成功，但站点少了页面** —— 直到有人在搜索里找不到自己的产品 | 预渲染**必须翻页取完**（按 `total` 判断），并在超过页数上限时**中断构建**而不是产出不完整的站点 | 已在 `prerender.mjs` 实现；可加断言"产出页数 == total × 语种数" | [实测] P0.3 |
| P-21 | **SSR 里的模块级可变状态会跨页面泄漏** | 把站点数据放在模块级 `reactive`/普通变量里 → 同一进程顺序渲染多个页面时，上一个页面的数据串到下一个。症状是"某些页面偶发出现别的产品名"，**极难复现** | 用 `provide`/`inject`（生命周期绑在 app 实例上），或每次渲染新建实例。**禁止模块级可变状态** | 人工评审（不可判定 → exit 2）| [结构] 已在 `site-context.ts` 设计上规避 |
| P-22 | **测试里手写盘符路径** | 断言 `path.resolve(cwd, …)` 的结果以 `C:/repo` 开头 → **在 Linux 上必然失败**：POSIX 下 `C:/repo` 不是绝对路径，`resolve` 会把它当相对路径拼到 `process.cwd()` 后面 | 测试里的路径一律由 `node:path` / `node:os` 生成（`join(tmpdir(), …)`），**绝不手写盘符或分隔符**；CI 至少要在一个非 Windows 平台跑一次 | 代码评审 + 多平台跑测试 | [实测] 服务器首次 `pnpm test` 撞上 —— 这个测试在本机（Windows）一直是通过的 |
| P-23 | **部署机上跑 `pnpm install` 会重写 `pnpm-lock.yaml`** | lockfile 被改写后变成"已跟踪文件的本地改动"，下一次 `git pull` 报 `Your local changes to the following files would be overwritten by merge: pnpm-lock.yaml` 而中止。成因是服务器的 pnpm 版本或 registry 与生成 lockfile 的机器不一致 | 部署机上**一律用 `pnpm install --frozen-lockfile`** —— 它不匹配时**报错而不是改写**；lockfile 只在开发机上生成。已撞上时：`git checkout -- pnpm-lock.yaml` 再 pull | 部署文档的安装命令已改为 --frozen-lockfile | [实测] 服务器第二次 git pull 撞上 |

---

## 5. 增量维护规则

| 改动类型 | 需要更新的条目 |
|---|---|
| 新增文件 | 补一条条目；**检查是否需要新约束 —— 理想情况是不需要**（这正说明锚定生效）|
| 新增业务域 | 先改 §0.3 字典，再写条目（**顺序不能反**）|
| 新增架构层 | 先改 §0.2 字典；只在某类文件 ≥3 个时才提升为层 |
| 改公开接口 | 更新该条目的 `A` 与相关条目的 `R` |
| 踩到新坑 | §4 加一行，**并给它一个可执行检查形态**（写不出来 ≙ 它大概率不会生效）|
| 文件重要性变了 | 改 `C` 值 —— 它是 token 预算 |
| 每季度 | 重跑 `pnpm strata:measure` 与 `pnpm strata:measure:index`，看 κ 与 γ 是否漂移 |

**维护协议**：

1. **只写"读代码看不出来"的东西** —— 设计取舍、约束、陷阱。
2. **`S` 里禁止原始代码** —— 压缩成高熵关键词。
3. **索引过期比没有索引更危险**（它看起来权威）。
   所以 `pnpm strata:check` **顺便校验索引完整性**（新增文件是否都有条目），
   把"记得更新"从人的记性变成机械检查 —— 见 `strata/checks/index-integrity.mjs`。
4. **改 `strata/constraints.mjs` 单独提交** —— 让"约束引入的时刻"可追溯
   （`git log -- strata/constraints.mjs`），这是判断"散文 vs 可执行"效果的前提。

---

## 6. 本实例的自测指标

> **STRATA 的收益是假设，不是已验证的事实。本节的数字就是本项目对它的检验。**
> 测量时间：**P0 结束**（契约层 7 + 服务端 13 + 前台 15 + 测试 5 + 规范层 13 = 54 个源码文件）。

| 指标 | 定义 | 本实例值 | 判据 |
|---|---|---|---|
| 条目数 `\|F\|` | 索引覆盖的 code unit 数 | **46** | — |
| 面数 `\|faces\|` | 实测用到的 `⟨层,域⟩` 组合数 | **19** | 上界 132 |
| **`κ`** | 共享面（≥2 条目）覆盖的条目比例 | **0.717** | **< 0.3 则本项目不适用** |
| `γ` | 新增文件里"需要新增约束"的比例 | 见 §6.2 | 面制应显著低于逐点制 |

### 6.1 κ **有区分力**，但它测的是"面密"，不是"方法有效"

`κ = 0.717` 来自 19 个面。作为参照，STRATA 的起源案例是 **0.68**。

**但这不是"面锚定有效"的证据。** κ 只说明"面是有效的压缩"，
不说明"约束因此更容易被遵守"。后者要靠 STRATA 尚未完成的实验（E1–E4）回答。
本节的结论边界因此是：**测量可信，收益待检验。**

> ### 值得记下的两次变化
>
> | 时点 | `\|F\|` | `\|faces\|` | `κ` | 读法 |
> |---|---|---|---|---|
> | 规范层落地 | 11 | 1 | **1.000** | **退化值** —— 单面装下全部条目，κ 必然为 1；退化守卫会拒绝下结论 |
> | 骨架落地（后端）| 31 | 13 | **0.774** | 首次有区分力 |
> | P0 结束（加前台与测试）| 46 | 19 | **0.717** | **κ 降了** |
>
> **κ 从 0.774 降到 0.717，是真实信号而不是退化**：前台引入了 `V/O/X/N` 四个层
> 与 `UI/ST/CT` 等域的组合，而前台当前只有 15 个文件，**多数面是单件的**
> （`K·ST`、`K·AU`、`K·CH`、`K·PD`、`C·CO`、`S·PD`、`R·CO`、`N·ST`、`O·UI`…）。
> 后端反而更"面密"：它每个域都有 `R`/`S`/`D` 三层配套。
>
> **含义**：κ 会随**骨架期**的推进而波动，「页面数少于域数」时前台天然稀疏。
> 这不是方法失效，而是**业务量还没填进来**。按 STRATA §3.4 的实测修正，
> 收益本来就不均匀 —— 重区（后端 `D`/`R`、`E·CO`、`K·CO`）承担了大部分条目，
> 轻区（前台各域）当前是单件面。**下结论要等 P1/P2 结束后重测。**

### 6.2 `γ` 目前仍不具区分力

`γ` 度量"新增文件里带来一个新面的比例"。上一次实测（目录代理口径）得到 `γ = 0.231`
（13 个新增文件 → 3 个新面），但**这个数现在没有意义**：

1. 它是**单次提交**的产物 —— 初始提交一次性加入全部文件，
   度量的是"第一次提交"，不是方法的长期行为。
2. `γ` 只在**后续持续新增文件**时才说明问题：γ 低 = 新文件大多落在已有面上 = 锚定有收益。

要得到有意义的 `γ`，需要**积累若干次真实的功能提交之后**再测。

> **这正是 STRATA 要求「索引与骨架必须在同一次提交里引入」的原因** ——
> 否则索引是事后补的，面可能已经退化成点，而 `γ` 再也测不准
> （起源案例正是因为 git 历史被压缩而无法支撑测量）。

### 6.3 测法与命令

```bash
pnpm strata:selftest        # 先验判决层自己的契约（0/1/2）—— 契约不可信则其余结论都不可信
pnpm strata:check           # 判决层：面锚定的约束
pnpm strata:measure:index   # 权威 κ（从本索引条目计算）
pnpm strata:measure         # 近似 κ 上界 + γ（目录代理，需要 git 历史）
```

> ### ⚠️ 必须声明的限制（照抄 STRATA 的诚实要求）
>
> - `measure.mjs` 用**目录结构**代理面时，κ **系统性偏高** ——
>   "同一目录 ⇒ 同面"是构造上必然的，所以那是**上界**，不是估计值。
>   有意义的 κ 必须用 §0 的字典或本索引来计算。
> - **κ ≥ 0.5** → 方法适用；**0.3–0.5** → 只在密集区域有收益，
>   报告结论时**必须限定范围**；**< 0.3** → 面已退化为点，
>   **只保留判决层**（`quickstart.md` §5），它不依赖 κ。
> - **`γ` 需要 git 历史**，因此**索引与骨架必须在同一次提交里引入** ——
>   否则"索引是事后补的"，面可能已经退化成点。
