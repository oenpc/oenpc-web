/**
 * 审计日志的**端口**（AL 域）。
 *
 * ## 「只追加」在类型层面就锁死了
 *
 * 这个接口**刻意只有 `append` 与 `recent`** —— 没有 `update`、没有 `delete`。
 * 硬约束 `append-only-audit` 因此不必靠检查器去扫"有没有人写了 UPDATE"：
 * **调用方根本拿不到那个能力**。
 *
 * 这是"让错误不可能发生"优于"让错误被发现"的一个实例，也是本层最省事的做法 ——
 * 约束写在类型里，比写在文档里或检查脚本里都可靠。
 */

export interface AuditEntryRecord {
  id: string
  actorId: string | null
  actorName: string
  action: string
  objectType: string
  objectId: string
  detail: Record<string, unknown> | null
  createdAt: string
}

export interface AuditAppendInput {
  id: string
  /** 无主体时（如登录失败）为 null。 */
  actorId: string | null
  /** **用户名快照**：用户后来改名或被删除，历史记录仍应显示当时是谁干的。 */
  actorName: string
  /** 动作用封闭短串，如 `product.create` / `auth.login.failed`。 */
  action: string
  objectType?: string
  objectId?: string
  detail?: Record<string, unknown>
  now: string
}

export interface AuditRepository {
  append(entry: AuditAppendInput): void
  recent(limit: number): AuditEntryRecord[]
}
