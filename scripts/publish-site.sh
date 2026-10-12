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

# ★ 取值优先级必须是**三级**：已有值（配置文件 / 环境变量）> OENPC_WEB_SITE_URL > 默认值。
#
# 早期版本写的是 SITE_URL="${OENPC_WEB_SITE_URL:-http://${A_HOST}}" ——
# 它会把 .publish-site.env 里刚设好的 SITE_URL **直接覆盖掉**
# （因为 OENPC_WEB_SITE_URL 通常没设，于是落到默认值）。
# 后果极隐蔽：配置文件看起来生效了，脚本也"成功"了，
# 但构建出来的页面与 sitemap 仍指向旧地址。
SITE_URL="${SITE_URL:-${OENPC_WEB_SITE_URL:-http://${A_HOST}}}"
API_BASE="${API_BASE:-${OENPC_WEB_API_BASE:-http://172.19.229.191:3900}}"
SITE_DIR="${SITE_DIR:-/var/www/oenpc-web/site}"
ADMIN_DIR="${ADMIN_DIR:-/var/www/oenpc-web/admin}"

# 立刻回显生效值 —— 配置没传进来时，第一眼就能看到，不必等构建跑完
printf '配置：SITE_URL=%s\n      API_BASE=%s  远程=%s@%s\n' \
  "$SITE_URL" "$API_BASE" "$A_USER" "$A_HOST"

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
echo "  站点地址 ${SITE_URL}"

# 取 sitemap：**跟随重定向**并记录最终地址与状态码。
#
# 早期版本只用 curl -fS（不跟随重定向），于是当站点是 http→https 跳转时，
# 拿到的是一个空的 301 响应体 → 页面数记成 0 → 误报"同步没生效"。
# **A 机上已有 HTTPS 站点时，这种跳转是常态**，所以这个 bug 一定会撞上。
TMP_SITEMAP=$(mktemp)
META=$(curl -sSL --max-time 20 -o "$TMP_SITEMAP" -w '%{http_code} %{url_effective}' "${SITE_URL}/sitemap.xml" || echo '000 ?')
REMOTE_CODE=${META%% *}
EFFECTIVE_URL=${META#* }
REMOTE_URLS=$(grep -c '<loc>' "$TMP_SITEMAP" 2>/dev/null || true)

echo "  A 机 sitemap 页面数: ${REMOTE_URLS}（本地 ${LOCAL_URLS}）  HTTP ${REMOTE_CODE}"
if [ "$EFFECTIVE_URL" != "${SITE_URL}/sitemap.xml" ]; then
  echo "  实际取到的是: ${EFFECTIVE_URL}"
fi

# ★ 核对**产物里的主机名**与配置的 SITE_URL 是否一致。
#
# 这是"构建时用的不是这个 SITE_URL"的直接证据 —— 例如配置文件没生效、
# 或产物是上一次构建留下的。**只看页面数是看不出这一类问题的**：
# 页面数可以完全正确，而里面每个 URL 的主机名都是错的。
if [ "$REMOTE_URLS" != "0" ]; then
  SITEMAP_HOST=$(grep -o '<loc>[^<]*' "$TMP_SITEMAP" | head -1 | sed 's|<loc>||' | sed -E 's#^https?://([^/]+).*#\1#')
  SITE_HOST=$(printf '%s' "$SITE_URL" | sed -E 's#^https?://([^/]+).*#\1#')
  if [ "$SITEMAP_HOST" != "$SITE_HOST" ]; then
    echo "" >&2
    echo "❌ 页面里的主机名与 SITE_URL 不一致" >&2
    echo "   产物里是： ${SITEMAP_HOST}" >&2
    echo "   配置里是： ${SITE_HOST}" >&2
    echo "
   说明**本次构建用的不是这个 SITE_URL**（产物是旧的，或配置没传进构建）。

   依次核对：
     cat /opt/oenpc-web/.publish-site.env                 # SITE_URL 写对了吗
     echo \"OENPC_WEB_SITE_URL=\$OENPC_WEB_SITE_URL\"       # 若它有值，会覆盖配置文件
     grep -n 'SITE_URL=' /opt/oenpc-web/scripts/publish-site.sh | head -2

   改完**必须重新构建**（SITE_URL 是构建期写进 HTML 与 sitemap 的）。" >&2
    rm -f "$TMP_SITEMAP"
    exit 1
  fi
fi

if [ "$REMOTE_URLS" != "$LOCAL_URLS" ]; then
  echo "" >&2
  echo "❌ 页面数不一致（本地 ${LOCAL_URLS}，A 机 ${REMOTE_URLS}）" >&2

  if [ "$EFFECTIVE_URL" != "${SITE_URL}/sitemap.xml" ]; then
    echo "
   请求被重定向到了： ${EFFECTIVE_URL}
   —— 说明 SITE_URL 与实际访问地址不一致。

   最常见：站点跑在 HTTPS / 域名上，而 SITE_URL 还写着 http://<IP>。

   ★ SITE_URL 是**构建期烧进 HTML** 的（canonical / hreflang / sitemap 都用它生成绝对地址）。
     填错会让页面里的互指链接**全部指向错地址，而且不报错** ——
     搜索引擎会把这些页面判为重复内容。
   修法：改 .publish-site.env 与 B 机 .env 里的 SITE_URL，
         然后**重新构建并发布**（只改配置不重建是没用的）。" >&2

  elif [ "$REMOTE_CODE" = "404" ]; then
    echo "
   HTTP 404 —— 文件没被这个域名的 nginx 找到。

   注意：A 机上已有 HTTPS 站点时，你那个域名的 server 块可能
   **不是**指向 ${SITE_DIR}。核对：
     ls -la '${SITE_DIR}/sitemap.xml'
     sudo nginx -T | grep -nE 'server_name|root '        # 看该域名的 root 到底指哪" >&2

  else
    echo "
   HTTP ${REMOTE_CODE}，但页面数与本地对不上 —— 可能同步不完整或被缓存。
   A 机上核对：
     ls -la '${SITE_DIR}/'
     grep -c '<loc>' '${SITE_DIR}/sitemap.xml'           # 应与本地 ${LOCAL_URLS} 相同" >&2
  fi

  rm -f "$TMP_SITEMAP"
  exit 1
fi
rm -f "$TMP_SITEMAP"

# 经 A 机反代的健康检查（同样跟随重定向）
if curl -fsSL --max-time 10 "${SITE_URL}/api/health" >/dev/null; then
  echo "  经 A 机反代的 /api/health ✓"
else
  echo "  ⚠ ${SITE_URL}/api/health 不通 —— 静态页已发布，但接口反代有问题（见 nginx 配置的 /api/ 段）" >&2
fi

# 抽查首页确实拿得到
if curl -fsSL --max-time 10 "${SITE_URL}/" >/dev/null; then
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
