#!/usr/bin/env bash
#
# 一键发布站点到 A 机 —— 在 B 机上执行。
#
# 内容改了之后要跑的命令不止一条，而且**顺序不能反**：
# 前台是 SSG，页面是构建期从 API 拉数据生成的，
# 所以「先重建、再传」；反过来传上去的还是旧页面。
# 这个脚本把顺序固定下来，并在最后**真的去 A 机取一次页面**验证。
#
#   ./scripts/publish-site.sh              # 重建并发布（内容变更后的常用操作）
#   ./scripts/publish-site.sh --no-build   # 只重传（构建产物没变时）
#   ./scripts/publish-site.sh --dry-run    # 只显示会传什么，不实际传
#
# 可用环境变量覆盖（默认已按实际拓扑填好）：
#   A_HOST=172.19.3.47  A_USER=root
#   OENPC_WEB_SITE_URL=http://172.19.3.47
#   OENPC_WEB_API_BASE=http://172.19.229.191:3900
#   SITE_DIR=/var/www/oenpc-web/site  ADMIN_DIR=/var/www/oenpc-web/admin

set -euo pipefail

# 可选：把本机拓扑配置放在仓库根的 .publish-site.env（已 gitignore），免得每次敲环境变量。
# 例： A_USER=deploy        （A 机不允许 root 登录时必须改）
#      SITE_DIR=/srv/www/oenpc-web/site
# 先 source 再取默认值 —— 这样文件里的值优先，缺的才用默认。
CONFIG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.publish-site.env"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

A_HOST="${A_HOST:-172.19.3.47}"
A_USER="${A_USER:-root}"
SITE_URL="${OENPC_WEB_SITE_URL:-http://${A_HOST}}"
API_BASE="${OENPC_WEB_API_BASE:-http://172.19.229.191:3900}"
SITE_DIR="${SITE_DIR:-/var/www/oenpc-web/site}"
ADMIN_DIR="${ADMIN_DIR:-/var/www/oenpc-web/admin}"

BUILD=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REMOTE="${A_USER}@${A_HOST}"
say() { printf '\n=== %s ===\n' "$1"; }

# ─────────────────────────── 前置检查 ───────────────────────────
# 及早失败，并说清"缺什么、怎么办"。让后续步骤用一个含糊的错误失败，
# 排查成本会高得多。

say "前置检查"

for cmd in rsync ssh curl; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "缺少命令：$cmd
  Debian/Ubuntu: sudo apt install -y $cmd
  RHEL/CentOS:   sudo yum install -y $cmd" >&2
    exit 2
  }
done

echo "  站点地址   ${SITE_URL}"
echo "  接口来源   ${API_BASE}"
echo "  目标       ${REMOTE}:${SITE_DIR}"

# 前台构建期要从 API 拉数据 —— API 不通就不必往下走了
if ! curl -fsS --max-time 10 "${API_BASE}/api/health" >/dev/null; then
  echo "
无法访问 API：${API_BASE}/api/health

前台是 SSG，**构建期必须能从 API 拉数据**。请确认：
  · 应用已启动：systemctl status oenpc-web-server
  · OENPC_WEB_API_BASE 指向的是本机的内网地址（不是 127.0.0.1 —— 绑了具体地址后回环上没有服务）" >&2
  exit 1
fi
echo "  API 可达 ✓"

# 免密登录没配好时，rsync 会在中途停下来问密码 —— 若是无人值守就卡死。
# 这里提前用 BatchMode 探一次，给出可操作的提示。
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "${REMOTE}" true 2>/dev/null; then
  echo "
无法免密登录 ${REMOTE}。

  · 还没配密钥：
      ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519   # 若还没有
      ssh-copy-id ${REMOTE}
  · 想临时输密码：去掉本脚本里的 BatchMode 检查，或手工执行 rsync
  · A 机没装 rsync：sudo apt install -y rsync" >&2
  exit 1
fi
echo "  免密登录 ${REMOTE} ✓"

# ─────────────────────────── 构建 ───────────────────────────

if [ "$BUILD" -eq 1 ]; then
  say "构建"
  echo "  （前台 SSG 会向 ${API_BASE} 取数据，耗时随产品数量增长）"

  # 后台与数据无关，先构建它
  pnpm --filter @oenpc-web/admin build

  OENPC_WEB_SITE_URL="$SITE_URL" OENPC_WEB_API_BASE="$API_BASE" \
    pnpm --filter @oenpc-web/web build
else
  say "构建（已跳过）"
  [ -f apps/web/dist/client/index.html ] || { echo "没有构建产物，去掉 --no-build 重跑" >&2; exit 1; }
fi

LOCAL_SITEMAP="apps/web/dist/client/sitemap.xml"
[ -f "$LOCAL_SITEMAP" ] || { echo "缺少 ${LOCAL_SITEMAP} —— 前台构建不完整" >&2; exit 1; }
LOCAL_URLS=$(grep -c '<loc>' "$LOCAL_SITEMAP" || true)
echo ""
echo "  前台页面数（sitemap）: ${LOCAL_URLS}"
echo "  前台体积: $(du -sh apps/web/dist/client | cut -f1)   后台体积: $(du -sh apps/admin/dist | cut -f1)"

# ─────────────────────────── 上传 ───────────────────────────

say "上传到 A 机"

RSYNC_FLAGS=(-az --delete --human-readable)
[ "$DRY_RUN" -eq 1 ] && RSYNC_FLAGS+=(--dry-run --itemize-changes)

# 先确保目标目录存在（首次发布时它们还不存在）
if [ "$DRY_RUN" -eq 0 ]; then
  ssh "${REMOTE}" "mkdir -p '${SITE_DIR}' '${ADMIN_DIR}'"
fi

# 注意结尾的斜杠：传的是目录**内容**，否则会多出一层 site/client/
rsync "${RSYNC_FLAGS[@]}" apps/web/dist/client/ "${REMOTE}:${SITE_DIR}/"
rsync "${RSYNC_FLAGS[@]}" apps/admin/dist/       "${REMOTE}:${ADMIN_DIR}/"

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry-run 结束"
  echo "  上面列出的就是会被同步的文件。去掉 --dry-run 实际执行。"
  exit 0
fi

# ─────────────────────────── 验证 ───────────────────────────
# 不验证的发布等于没发布：文件可能落错目录、nginx 可能指向旧 root、
# 中间可能隔着缓存。这里**真的去 A 机取一次**。

say "验证"

REMOTE_URLS=$(curl -fsS --max-time 15 "${SITE_URL}/sitemap.xml" | grep -c '<loc>' || true)
echo "  A 机 sitemap 页面数: ${REMOTE_URLS}（本地 ${LOCAL_URLS}）"
if [ "$REMOTE_URLS" != "$LOCAL_URLS" ]; then
  echo "
❌ 页面数不一致 —— 同步没生效或 nginx 指错了目录。

  逐项排查：
    1. A 机上确认文件到位： ls '${SITE_DIR}'
    2. nginx 的 root 是否指向它： grep -n 'root ' /etc/nginx/conf.d/oenpc-web.conf
    3. reload： sudo nginx -t && sudo systemctl reload nginx
    4. 是否被缓存： curl -fsS -H 'Cache-Control: no-cache' '${SITE_URL}/sitemap.xml' | head" >&2
  exit 1
fi

# 经 A 机反代的健康检查：验证 nginx 的 /api/ 反代仍然通
if curl -fsS --max-time 10 "${SITE_URL}/api/health" >/dev/null; then
  echo "  经 A 机反代的 /api/health ✓"
else
  echo "  ⚠ ${SITE_URL}/api/health 不通 —— 静态页已发布，但接口反代有问题（见 nginx 配置的 /api/ 段）" >&2
fi

# 抽查首页确实拿得到
if curl -fsS --max-time 10 "${SITE_URL}/" >/dev/null; then
  echo "  首页可访问 ✓"
else
  echo "  ⚠ 首页返回异常" >&2
fi

say "完成"
echo "  前台 ${SITE_URL}/          后台 ${SITE_URL}/admin/"
echo ""
echo "  改了内容后重复执行本脚本即可（前台是静态页，不会自动更新）。"
echo "  只改了后台代码时用： ./scripts/publish-site.sh --no-build"
echo "  改了服务端代码时还要： sudo systemctl restart oenpc-web-server"
