/*
 * 后台的本地偏好：亮/暗主题、以及"当前是谁"的显示来源。
 *
 * 为什么单独一个文件而不是塞进 `session.ts`：
 * `session.ts` 只管**令牌**（会话本身），而主题与"显示谁登录了"是**界面偏好**，
 * 两者生命周期完全不同 —— 退出登录必须清令牌，但**不该清主题**
 * （同一个人下次登录仍希望是暗色）。混在一个模块里，早晚会出现
 * "退出登录顺手把主题也重置了"这种没人要求的副作用。
 *
 * 所有读写都吞掉异常：隐私模式下 localStorage 可能直接抛错。
 * 这里没有"必须存进去"的语义 —— 存不了就退化为"本次内存有效"，绝不阻断界面。
 */

const THEME_KEY = 'oenpc-web.admin.theme'
const IDENTITY_KEY = 'oenpc-web.admin.identity'

export type ThemeMode = 'light' | 'dark'

/**
 * 读主题。**同步读**是有意的：主题必须在首帧之前就定下来，
 * 否则暗色用户每次刷新都会先看到一帧白屏（闪一下比没有暗色更难受）。
 */
export function getThemeMode(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    /* 存不进去就当"本次会话有效" */
  }
}

/** 登录后记下的展示名。null = 没记过（例如直接带令牌打开页面）。 */
export function getAdminIdentity(): string | null {
  try {
    return window.localStorage.getItem(IDENTITY_KEY)
  } catch {
    return null
  }
}

export function setAdminIdentity(display: string | null): void {
  try {
    if (display === null) window.localStorage.removeItem(IDENTITY_KEY)
    else window.localStorage.setItem(IDENTITY_KEY, display)
  } catch {
    /* 同上 */
  }
}
