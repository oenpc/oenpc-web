/**
 * 权限点 —— **封闭枚举**。
 *
 * 角色是对权限点的集合，权限点是这里列出的字符串。
 * 用联合类型而不是 `string`，是为了让「写错的权限点」在**编译期**就报错：
 * 一个拼错的权限点在运行时表现为"某个功能突然 403"，而 403 很容易被当成
 * 前端没登录，排查方向完全错。
 *
 * 命名约定：`<资源>:<动作>`。资源名与 B 维业务域一一对应。
 */

import type { LocalizedText } from './locales.js'

export const PERMISSIONS = [
  /* 产品（PD） */
  'product:read',
  'product:write',
  'product:publish',
  'product:import',
  /* 内容（CT） */
  'content:read',
  'content:write',
  /* 购买渠道（CH） */
  'channel:read',
  'channel:write',
  /* 询盘（IQ） */
  'inquiry:read',
  'inquiry:write',
  /* 媒体（MD） */
  'media:read',
  'media:write',
  'media:delete',
  /* 站点设置（ST） */
  'site:read',
  'site:write',
  /* 报表（AN） */
  'report:read',
  'report:export',
  /* 审计（AL） */
  'audit:read',
  /* 用户与角色（AU） */
  'user:manage',
  'role:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** 是否是一个已知权限点 —— 用于加载角色配置时的校验。 */
export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value)
}

/**
 * 角色。
 *
 * **`isOwner` 不等同于"权限列表里有一堆权限"**：owner 是**隐式全权**，
 * 由服务端判定，不展开成权限点列表 —— 这样新增权限点时不必回头补 owner，
 * 而漏补的症状是"超管突然失去新功能"，很难联想到权限配置。
 *
 * 角色名要给中文运营者看，所以同样走多语结构。
 */
export interface Role {
  id: string
  name: LocalizedText
  permissions: Permission[]
  /** 隐式全权角色，不受 `permissions` 列表限制。 */
  isOwner: boolean
  /** ISO8601 **UTC**，展示层才做时区转换。 */
  createdAt: string
  updatedAt: string
}
