#!/usr/bin/env bash
#
# 一键拉取并部署 —— 在 B 机（172.19.229.191）上执行。
#
#   ./scripts/deploy.sh                    # 拉代码 → 装依赖 → 构建 → 重启 → 验证 → 发布前台到 A 机
#   ./scripts/deploy.sh --no-frontend      # 只更新 B 机（不动 A 机的前台）
#   ./scripts/deploy.sh --no-pull          # 跳过 git pull，部署当前检出的版本（回滚时有用）
#   ./scripts/deploy.sh --dry-run          # 只显示会做什么，不改动任何东西
#
# 设计原则：**先检查、再动手；每一步失败就停，并说清怎么修。**
# 部署脚本最糟的形态是"跑到一半失败了、但你已经不知道处在什么状态"。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PULL=1
FRONTEND=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-frontend) FRONTEND=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

say() { printf '\n=== %s ===\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# 需要 root 时才用 sudo —— 不要求整个脚本以 root 跑
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  printf '\n$ %s\n' "$*"
  "$@"
}

# ═══════════════════════════════════════════════════════════════════════════
#  前置检查 —— 及早失败，并说清缺什么、怎么修
# ═══════════════════════════════════════════════════════════════════════════

say "前置检查"
[ -f pnpm-workspace.yaml ] || die "这里不是仓库根（缺 pnpm-workspace.yaml）：$REPO_ROOT"

# Node 版本：服务端用了内置的 node:sqlite，低版本直接起不来
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  die "Node 版本过低：$(node -v)，需要 >= 22.19.0
  服务端用了内置的 node:sqlite，低版本会直接启动失败。
  升级：  sudo nvm install 22  或  用发行版提供的 nodejs 22.x"
fi
ok "node $(node -v)"

command -v pnpm >/dev/null 2>&1 || die "缺少 pnpm：npm i -g pnpm@11.24.0"
ok "pnpm $(pnpm -v)"

# systemd 单元：没装过的话，后面 restart 会以"Unit not found"失败，先在这里拦住
if ! systemctl list-unit-files 2>/dev/null | grep -q '^oenpc-web-server\.service'; then
  die "找不到 systemd 单元 oenpc-web-server.service
  先装：  sudo cp deploy/oenpc-web-server.service /etc/systemd/system/
          sudo systemctl daemon-reload
          sudo systemctl enable --now oenpc-web-server"
fi
ok "systemd 单元已安装"

if [ "$PULL" -eq 1 ]; then
  git rev-parse --git-dir >/dev/null 2>&1 || die "这里不是 git 仓库：$REPO_ROOT"

  # git 的 dubious ownership：仓库属主与执行者不一致。这是**属主配错**的信号，
  # 最干净的修法是恢复属主（代码归部署者、只有 data/ 归服务账号），
  # 而不是用 safe.directory 绕过保护。
  if ! git status >/dev/null 2>&1; then
    die "git 拒绝操作这个仓库（多半是 dubious ownership）：
  $(git status 2>&1 | head -1)
  推荐修法（属主关系错了）：
      sudo chown -R root:root '$REPO_ROOT'
      sudo chown -R oenpc-web:oenpc-web '$REPO_ROOT/data'
  应急（绕过保护）：
      sudo git config --global --add safe.directory '$REPO_ROOT'"
  fi

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$BRANCH" = "main" ] || die "当前在分支 $BRANCH 上，部署应基于 main：
      git checkout main && git branch --set-upstream-to=origin/main main"

  git remote get-url origin >/dev/null 2>&1 || die "没有 origin 远端：
      git remote add origin https://github.com/oenpc/oenpc-web.git"

  # pnpm-lock.yaml 在部署机上被 pnpm install 改写后，会成为"已跟踪文件的本地改动"
  # 而挡住 pull（陷阱 P-23）。它只应由开发机生成，所以这里**自动还原它是安全的**。
  # 其它已跟踪文件有改动则一律停下 —— 那可能是有人在服务器上直接改了代码。
  DIRTY="$(git status --porcelain --untracked-files=no | awk '{print $2}')"
  if [ -n "$DIRTY" ]; then
    OTHER="$(printf '%s\n' "$DIRTY" | grep -v '^pnpm-lock\.yaml$' || true)"
    if [ -n "$OTHER" ]; then
      die "以下已跟踪文件有本地改动，pull 会被挡住：
$(printf '%s\n' "$OTHER" | sed 's/^/      /')
  如果这些改动是有意的，先提交或 stash：
      git stash push -m 'deploy 前手工改动'
  如果不是有意的（例如在服务器上误改了文件）：
      git checkout -- <文件>"
    fi
    echo "  注意：pnpm-lock.yaml 有本地改动（多半是 pnpm install 改写的），自动还原它"
    run git checkout -- pnpm-lock.yaml
  fi
  ok "工作区干净（已跟踪文件）"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  更新代码与依赖
# ═══════════════════════════════════════════════════════════════════════════

if [ "$PULL" -eq 1 ]; then
  say "拉取代码"
  BEFORE="$(git rev-parse HEAD)"
  run git pull --ff-only
  AFTER="$(git rev-parse HEAD)"
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "已是最新（$BEFORE）"
  else
    ok "$BEFORE → $AFTER"
    git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/      /'
  fi
else
  say "拉取代码（已跳过 --no-pull）"
fi

say "安装依赖"
# ★ 一律 --frozen-lockfile：lockfile 与 package.json 不匹配时**报错而不是改写**。
#   部署机上重新解析依赖会让"我测过的版本"和"线上跑的版本"悄悄分叉；
#   改写后的 lockfile 还会在下一次 pull 时挡住部署（陷阱 P-23）。
run pnpm install --frozen-lockfile

# ═══════════════════════════════════════════════════════════════════════════
#  构建
# ═══════════════════════════════════════════════════════════════════════════

say "构建服务端"
run pnpm build

say "构建后台 SPA"
# ★ 必须先构建后台，否则应用启动时会打 warn、/admin/ 返回 404。
#   应用的默认目录推导依赖 apps/admin/dist 存在（见 config.ts 的默认值说明）。
run pnpm --filter @oenpc-web/admin build

# ═══════════════════════════════════════════════════════════════════════════
#  重启并验证
# ═══════════════════════════════════════════════════════════════════════════

say "重启服务"
run $SUDO systemctl restart oenpc-web-server

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry-run 结束"
  echo "  上面列出的就是会执行的动作。去掉 --dry-run 实际执行。"
  exit 0
fi

# 从 .env 读回实际监听地址与端口 —— 不要硬编码：
# 应用绑的是**具体内网地址**，回环上没有服务（这一点本项目实测过），
# 所以自检必须用配置里的地址，写 127.0.0.1 会得到"连不上"的假故障。
ENV_FILE="$REPO_ROOT/apps/server/.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  HOST="$(grep -E '^OENPC_WEB_HOST=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  PORT="$(grep -E '^OENPC_WEB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi
HOST="${HOST:-172.19.229.191}"
PORT="${PORT:-3900}"
BASE="http://${HOST}:${PORT}"

say "验证（${BASE}）"

# 服务刚重启，给它几秒钟起来；最多等 20 秒
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "${BASE}/api/health" >/dev/null 2>&1; then break; fi
  [ "$i" -eq 20 ] && {
    echo "" >&2
    echo "✗ 服务在 20 秒内没有就绪。排查：" >&2
    echo "    sudo systemctl status oenpc-web-server" >&2
    echo "    sudo journalctl -u oenpc-web-server -n 50 --no-pager" >&2
    echo "  常见原因：数据库文件属主不对（应用以 oenpc-web 身份跑，写不了 data/）" >&2
    exit 1
  }
  sleep 1
done

curl -fsS --max-time 5 "${BASE}/api/health" | head -c 200
echo ""
ok "接口就绪"

# 后台：不仅要 200，还要确认拿到的是**后台自己的页面**。
# 只返回 200 是不够的 —— 页面被别的东西顶替时也是 200，而点进去会白屏。
ADMIN_HTML="$(curl -fsSL --max-time 10 "${BASE}/admin/" || true)"
if printf '%s' "$ADMIN_HTML" | grep -q '/admin/assets/'; then
  ok "后台页面就绪（${BASE}/admin/）"
else
  printf '\n⚠ %s/admin/ 异常\n' "$BASE" >&2
  printf '  看日志里这一行确认它找的是哪个目录：\n' >&2
  printf "    sudo journalctl -u oenpc-web-server -n 50 | grep -i adminDir\n" >&2
  printf '  期望指向 %s/apps/admin/dist\n' "$REPO_ROOT" >&2
fi

# ═══════════════════════════════════════════════════════════════════════════
#  发布前台到 A 机
# ═══════════════════════════════════════════════════════════════════════════

if [ "$FRONTEND" -eq 1 ]; then
  # 前台是 SSG，**构建期要从 API 拉数据**，所以必须在服务起来之后再做。
  # 复用 publish-site.sh：它还负责传送到 A 机、并回取 A 机的 sitemap 做验证。
  say "发布前台到 A 机"
  if [ -x "$REPO_ROOT/scripts/publish-site.sh" ]; then
    "$REPO_ROOT/scripts/publish-site.sh"
  else
    echo "  ⚠ 未找到可执行的 scripts/publish-site.sh，跳过前台发布。"
    echo "    只改后台时用 --no-frontend 可以避免每次都被提醒。"
    echo "    需要发布时：  chmod +x scripts/publish-site.sh && ./scripts/publish-site.sh"
  fi
else
  say "发布前台（已跳过 --no-frontend）"
  echo "  注意：前台是 SSG 静态页，**改了产品内容不会自动更新**。"
  echo "  内容有变化时执行：  ./scripts/publish-site.sh"
fi

say "完成"
echo "  后台  ${BASE}/admin/"
[ "$FRONTEND" -eq 1 ] && echo "  前台  已发布（见上面 publish-site.sh 的输出）"
echo ""
echo "  回滚：  git reset --hard <上一个提交> && ./scripts/deploy.sh --no-pull --no-frontend"
