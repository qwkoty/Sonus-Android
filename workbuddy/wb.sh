#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy 手机端一键部署：装 Debian 容器 → 装客户端 → VNC 登录 → 自动取 token → 开启每日自动签到
# 用法:
#   ./wb.sh          一键全流程（首次约 30~60 分钟，取决于网速）
#   ./wb.sh stop     关闭图形界面
#   ./wb.sh token    重新取一次 token（token 过期时用）
set -uo pipefail

DISTRO="debian"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"
ROOTFS="$PREFIX_DIR/var/lib/proot-distro/installed-rootfs/$DISTRO"
MARK="$ROOTFS/root/.wb-ok"
INFO="$ROOTFS/root/.config/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"
SRC_JS="https://temp.sh/PjaSu/wb-token.js"
SRC_SH="https://temp.sh/PndnB/workbuddy.sh"
WAIT_SECONDS=1500

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "\033[0;37m%s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

fetch() {
  local url="$1" dest="$2" i
  for i in 1 2 3; do
    curl -fsS -X POST -o "$dest" "$url" && [ -s "$dest" ] && return 0
    sleep 2
  done
  return 1
}

bin_path() { cat "$ROOTFS/opt/.wb-bin" 2>/dev/null; }

container_sh() {
  proot-distro login "$DISTRO" -- bash -lc "$1"
}

install_everything() {
  step "0/6 环境检查"
  command -v pkg >/dev/null 2>&1 || { bad "必须在 Termux 里运行"; exit 1; }
  termux-wake-lock 2>/dev/null || warn "拿不到 wake-lock，安装期间请插电、别锁屏"
  info "剩余空间："
  df -h "$HOME" | tail -1

  if ! command -v curl >/dev/null 2>&1; then
    pkg install -y curl || warn "curl 安装失败"
  fi

  step "1/6 拉取手机端脚本"
  fetch "$SRC_SH" "$HOME/workbuddy.sh" || warn "workbuddy.sh 下载失败（以后可手动放）"
  fetch "$SRC_JS" "$HOME/wb-token.js" || warn "wb-token.js 下载失败"
  [ -s "$HOME/workbuddy.sh" ] && chmod +x "$HOME/workbuddy.sh"

  step "2/6 安装 proot-distro"
  if ! command -v proot-distro >/dev/null 2>&1; then
    pkg update -y >/dev/null 2>&1 || warn "pkg update 失败（可先 termux-change-repo 换源）"
    pkg install -y proot-distro || { bad "proot-distro 安装失败"; exit 1; }
  fi

  step "3/6 准备 Debian 容器"
  if [ ! -d "$ROOTFS/etc" ]; then
    proot-distro install "$DISTRO" || { bad "Debian 容器安装失败"; exit 1; }
  fi
  mkdir -p "$ROOTFS/root"

  if [ -f "$MARK" ]; then
    info "WorkBuddy 已安装过，跳过容器内安装"
    return 0
  fi

  step "4/6 容器内安装 WorkBuddy（最耗时的一步）"
  cat > "$ROOTFS/root/install.sh" <<'EOS'
set -u
export DEBIAN_FRONTEND=noninteractive
apt-get update || { echo "[容器] apt update 失败"; exit 1; }

BASE="wget ca-certificates procps dbus dbus-x11 xvfb x11vnc fonts-noto-cjk xdg-utils"
apt-get install -y --no-install-recommends $BASE || apt-get install -y $BASE || true

LIBS="libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 libsecret-1-0 \
libgbm1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
libcairo2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libpulse0 libegl1 libgles2 libx11-xcb1"

if ! apt-get install -y --no-install-recommends $LIBS; then
  echo "[容器] 整组安装失败，逐个尝试（兼容 Debian 新版的 xxx-t64 改名）"
  for p in $LIBS libasound2; do
    if apt-get install -y --no-install-recommends "$p" >/dev/null 2>&1; then echo "  ok   $p"
    elif apt-get install -y --no-install-recommends "${p}t64" >/dev/null 2>&1; then echo "  ok   ${p}t64"
    else echo "  skip $p"; fi
  done
fi
apt-get install -y --no-install-recommends libasound2 >/dev/null 2>&1 \
  || apt-get install -y --no-install-recommends libasound2t64 >/dev/null 2>&1 || true

URL="https://download.codebuddy.cn/workbuddy/saas/linux-arm64-deb/WorkBuddy-linux-arm64-deb-5.6.2.40046327-c7b525f3.deb"
ok=0
for i in 1 2 3; do
  if wget -O /tmp/wb.deb "$URL"; then ok=1; break; fi
  echo "  下载失败，重试 $i"
  sleep 3
done
[ "$ok" = "1" ] && [ -s /tmp/wb.deb ] || { echo "[容器] deb 下载失败"; exit 1; }

dpkg -i /tmp/wb.deb || apt-get -f install -y || true

BIN=""
for c in /opt/WorkBuddy/workbuddy /opt/workbuddy/workbuddy /usr/bin/workbuddy /usr/share/workbuddy/workbuddy; do
  [ -x "$c" ] && BIN="$c" && break
done
[ -n "$BIN" ] || BIN=$(find /opt /usr -maxdepth 3 -name workbuddy -type f -perm -u+x 2>/dev/null | head -1)
if [ -z "$BIN" ]; then echo "[容器] 没找到 workbuddy 可执行文件"; ls -la /opt; exit 1; fi
echo "$BIN" > /opt/.wb-bin
touch /root/.wb-ok
echo "[容器] 安装完成: $BIN"
EOS
  proot-distro login "$DISTRO" -- bash /root/install.sh || { bad "容器内安装失败，看上面报错"; exit 1; }
}

start_gui() {
  step "5/6 启动虚拟桌面"
  cat > "$ROOTFS/root/start.sh" <<'EOS'
set -u
export DISPLAY=:1
pidof Xvfb >/dev/null 2>&1 || { Xvfb :1 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pidof x11vnc >/dev/null 2>&1 || { x11vnc -display :1 -forever -nopw -shared -rfbport 5900 -localhost >/tmp/vnc.log 2>&1 & sleep 1; }
BIN=$(cat /opt/.wb-bin 2>/dev/null)
[ -x "${BIN:-}" ] || BIN=/opt/WorkBuddy/workbuddy
exec dbus-run-session -- "$BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage
EOS
  if [ -f "$HOME/.wb-gui.pid" ]; then
    old=$(cat "$HOME/.wb-gui.pid" 2>/dev/null)
    [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null && kill "$old" 2>/dev/null
    rm -f "$HOME/.wb-gui.pid"
  fi
  nohup proot-distro login "$DISTRO" -- bash /root/start.sh >"$HOME/wb-gui.log" 2>&1 &
  echo $! > "$HOME/.wb-gui.pid"
  sleep 8

  echo ""
  echo "----------------------------------------------------------------"
  echo " 现在在手机上打开 VNC 客户端（bVNC / VNC Viewer），连："
  echo "     地址 127.0.0.1   端口 5900"
  echo " 连上后看得到 WorkBuddy 窗口，登录你的账号。"
  echo " 本脚本会自动检测登录完成后继续，你不用手动执行其他命令。"
  echo "----------------------------------------------------------------"
}

wait_login() {
  step "6/6 等待登录"
  local waited=0
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    if [ -s "$INFO" ]; then
      info "检测到登录状态文件，继续。"
      sleep 3
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
    if [ $((waited % 30)) -eq 0 ]; then
      info "已等待 $((waited / 60)) 分 $((waited % 60)) 秒…… 请在 VNC 画面里完成登录"
    fi
  done
  warn "等待超时，没有检测到登录。窗口应该还开着，你可以在 VNC 里登录后单独运行 ./wb.sh token"
  return 1
}

stop_gui() {
  if [ -f "$HOME/.wb-gui.pid" ]; then
    pid=$(cat "$HOME/.wb-gui.pid" 2>/dev/null)
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
    rm -f "$HOME/.wb-gui.pid"
  fi
  container_sh 'pkill -f workbuddy 2>/dev/null; pkill -x x11vnc 2>/dev/null; pkill -x Xvfb 2>/dev/null; true' >/dev/null 2>&1
}

get_token() {
  step "提取凭证"
  if [ ! -s "$INFO" ]; then
    bad "还没检测到登录状态，先登录再取。"
    return 1
  fi
  if [ ! -s "$ROOTFS/root/wb-token.js" ]; then
    if [ -s "$HOME/wb-token.js" ]; then
      cp "$HOME/wb-token.js" "$ROOTFS/root/wb-token.js"
    else
      fetch "$SRC_JS" "$HOME/wb-token.js" && cp "$HOME/wb-token.js" "$ROOTFS/root/wb-token.js"
    fi
  fi
  [ -s "$ROOTFS/root/wb-token.js" ] || { bad "缺少 wb-token.js"; return 1; }

  stop_gui
  sleep 2
  BIN=$(bin_path)
  OUT=$(proot-distro login "$DISTRO" -- bash -lc \
    "BIN='${BIN:-/opt/WorkBuddy/workbuddy}'; ELECTRON_RUN_AS_NODE=1 \"\$BIN\" /root/wb-token.js" 2>&1)
  BLOB=$(printf '%s\n' "$OUT" | grep -m1 '^WB1\.' | tr -d '\r')
  if [ -z "$BLOB" ]; then
    bad "没取到凭证，下面是客户端输出："
    printf '%s\n' "$OUT"
    return 1
  fi
  printf '%s\n' "$BLOB" > "$HOME/wb-token.txt"
  return 0
}

finish() {
  step "导入凭证并开启每日自动签到"
  BLOB=$(cat "$HOME/wb-token.txt")
  if [ ! -s "$HOME/workbuddy.sh" ]; then
    bad "缺少 workbuddy.sh"
    return 1
  fi
  chmod +x "$HOME/workbuddy.sh"
  "$HOME/workbuddy.sh" import "$BLOB"
  "$HOME/workbuddy.sh" checkin
  "$HOME/workbuddy.sh" auto

  echo ""
  echo "=================================================================="
  echo " 全部完成。以后每天 00:05 自动签到，不用再开 VNC。"
  echo " 查看状态:  ~/workbuddy.sh status"
  echo " 手动签到:  ~/workbuddy.sh checkin"
  echo " 关闭图形:  ~/wb.sh stop"
  echo " token 约 55 天过期，届时: ~/wb.sh token"
  echo "=================================================================="
}

case "${1:-all}" in
  all|install|run|"")
    install_everything
    start_gui
    wait_login && get_token && finish
    ;;
  token)
    get_token && finish
    ;;
  stop)
    stop_gui
    info "已关闭"
    ;;
  *)
    echo "用法: $0 [all|token|stop]"
    exit 1
    ;;
esac
