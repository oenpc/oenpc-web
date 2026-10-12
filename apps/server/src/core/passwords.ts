/**
 * 口令摘要 —— `scrypt`（Node 内置，零依赖）。
 *
 * ## 两个必须做对的地方
 *
 * ### 1. 用 `timingSafeEqual` 而不是 `===`
 *
 * 字符串比较会在第一个不同字节处提前返回，攻击者能通过响应时间**逐字节猜出**摘要。
 * 这不是理论问题：本地网络下这种时间差是可测量的。
 *
 * ### 2. 口令先做 NFKC 归一化
 *
 * 中文/全角字符在不同输入法下的码位可能不同（全角 `Ａ` 与半角 `A`），
 * 不做归一化会出现"我明明输对了却登不上"—— 而且用户无法自查。
 * 归一会略微改变口令空间，但换来的是**跨平台跨输入法的可复现性**，这个交换是划算的。
 *
 * ## 为什么不用 bcrypt / argon2
 *
 * 它们都需要原生编译依赖，而本项目的部署目标是"上传即可跑"。
 * `scrypt` 是 Node 内置的、被密码学界认可的内存硬函数，足够这个场景。
 * **若将来要提升强度，改的是本文件一处**，调用方不受影响。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64
const SALT_BYTES = 16
/** Node 的 scrypt 默认参数（N=16384, r=8, p=1）—— 显式写出来，避免依赖隐式默认值。 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const

export interface PasswordDigest {
  /** hex 编码的盐。 */
  salt: string
  /** hex 编码的摘要。 */
  hash: string
}

export function hashPassword(password: string): PasswordDigest {
  const salt = randomBytes(SALT_BYTES)
  const hash = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_OPTIONS)
  return { salt: salt.toString('hex'), hash: hash.toString('hex') }
}

export function verifyPassword(password: string, digest: PasswordDigest): boolean {
  let expected: Buffer
  let actual: Buffer
  try {
    expected = Buffer.from(digest.hash, 'hex')
    actual = scryptSync(password.normalize('NFKC'), Buffer.from(digest.salt, 'hex'), expected.length, SCRYPT_OPTIONS)
  } catch {
    /* 摘要字段损坏（手工改库、数据迁移出错）时返回 false，不要把异常抛给调用方 */
    return false
  }
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/** 口令最短长度 —— 在**创建用户时**校验，登录时不校验（老口令可能更短）。 */
export const MIN_PASSWORD_LENGTH = 8
