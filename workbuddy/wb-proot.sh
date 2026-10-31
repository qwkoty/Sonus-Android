#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy on Android —— proot-distro + Debian + Xvfb + VNC 一键方案
# 用法:
#   ./wb-proot.sh              安装（首次）并启动图形界面
#   ./wb-proot.sh token        登录后取 token（输出 WB1.xxx，可直接给 workbuddy.sh import）
#   ./wb-proot.sh stop         关闭 WorkBuddy / VNC / 虚拟屏
#   ./wb-proot.sh shell        进入 Debian 容器
set -uo pipefail

DISTRO="debian"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"
ROOTFS="$PREFIX_DIR/var/lib/proot-distro/installed-rootfs/$DISTRO"
MARK="$ROOTFS/root/.wb-ok"

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
warn() { printf "\033[1;33m[警告] %s\033[0m\n" "$1"; }
die()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; exit 1; }

need_termux() {
  command -v pkg >/dev/null 2>&1 || die "必须在 Termux 里运行"
}

do_install() {
  need_termux

  step "1/5 检查环境"
  termux-wake-lock 2>/dev/null || warn "termux-wake-lock 不可用，安装期间建议别锁屏"
  echo "当前可用空间："
  df -h "$HOME" | tail -1
  echo "提示：需要约 4GB 空闲空间"

  step "2/5 安装 proot-distro"
  if ! command -v proot-distro >/dev/null 2>&1; then
    pkg update -y >/dev/null 2>&1 || warn "pkg update 失败（可先运行 termux-change-repo 换镜像源）"
    pkg install -y proot-distro || die "proot-distro 安装失败"
  fi

  step "3/5 准备 Debian 容器"
  if [ ! -d "$ROOTFS/etc" ]; then
    proot-distro install "$DISTRO" || die "Debian 容器安装失败"
  fi
  mkdir -p "$ROOTFS/root"

  if [ ! -f "$MARK" ]; then
    step "4/5 容器内安装 WorkBuddy（首次较慢，请插电别锁屏）"
    cat > "$ROOTFS/root/install.sh" <<'EOS'
set -u
export DEBIAN_FRONTEND=noninteractive

echo "[容器] apt update"
apt-get update || { echo "[容器] apt update 失败，检查网络"; exit 1; }

echo "[容器] 安装基础依赖"
BASE="wget ca-certificates procps dbus dbus-x11 xvfb x11vnc fonts-noto-cjk xdg-utils"
apt-get install -y --no-install-recommends $BASE || apt-get install -y $BASE || true

echo "[容器] 安装 Electron 运行库"
LIBS="libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 libsecret-1-0 \
libgbm1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
libcairo2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libpulse0 libegl1 libgles2 libx11-xcb1"

if ! apt-get install -y --no-install-recommends $LIBS; then
  echo "[容器] 整组安装失败（多半是 Debian 新版把包名改成了 xxx-t64），改为逐个尝试"
  for p in $LIBS libasound2; do
    if apt-get install -y --no-install-recommends "$p" >/dev/null 2>&1; then
      echo "  ok   $p"
    elif apt-get install -y --no-install-recommends "${p}t64" >/dev/null 2>&1; then
      echo "  ok   ${p}t64"
    else
      echo "  skip $p"
    fi
  done
fi
apt-get install -y --no-install-recommends libasound2 >/dev/null 2>&1 \
  || apt-get install -y --no-install-recommends libasound2t64 >/dev/null 2>&1 || true

echo "[容器] 下载 WorkBuddy arm64 安装包"
URL="https://download.codebuddy.cn/workbuddy/saas/linux-arm64-deb/WorkBuddy-linux-arm64-deb-5.6.2.40046327-c7b525f3.deb"
ok=0
for i in 1 2 3; do
  if wget -O /tmp/wb.deb "$URL"; then ok=1; break; fi
  echo "  第 $i 次下载失败，重试..."
  sleep 3
done
if [ "$ok" != "1" ] || [ ! -s /tmp/wb.deb ]; then
  echo "[容器] 下载失败。可以手动把 deb 放进容器的 /root/wb.deb 后重新运行本脚本"
  exit 1
fi

echo "[容器] 安装 deb"
dpkg -i /tmp/wb.deb || apt-get -f install -y || true

echo "[容器] 定位可执行文件"
BIN=""
for c in /opt/WorkBuddy/workbuddy /opt/workbuddy/workbuddy /usr/bin/workbuddy /usr/share/workbuddy/workbuddy; do
  if [ -x "$c" ]; then BIN="$c"; break; fi
done
if [ -z "$BIN" ]; then
  BIN=$(find /opt /usr -maxdepth 3 -name workbuddy -type f -perm -u+x 2>/dev/null | head -1)
fi
if [ -z "$BIN" ]; then
  echo "[容器] 没找到 workbuddy 可执行文件，/opt 内容如下："
  ls -la /opt || true
  exit 1
fi

echo "$BIN" > /opt/.wb-bin
if [ ! -x "$BIN" ]; then echo "[容器] 可执行文件没有执行权限: $BIN"; exit 1; fi
echo "[容器] 安装完成: $BIN"
touch /root/.wb-ok
EOS
    proot-distro login "$DISTRO" -- bash /root/install.sh || die "容器内安装失败，上面有具体原因"
  fi

  step "5/5 启动图形界面"
  cat > "$ROOTFS/root/start.sh" <<'EOS'
set -u
export DISPLAY=:1
pidof Xvfb >/dev/null 2>&1 || { Xvfb :1 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pidof x11vnc >/dev/null 2>&1 || { x11vnc -display :1 -forever -nopw -shared -rfbport 5900 -localhost >/tmp/vnc.log 2>&1 & sleep 1; }
BIN=$(cat /opt/.wb-bin 2>/dev/null)
[ -x "${BIN:-}" ] || BIN=/opt/WorkBuddy/workbuddy
exec dbus-run-session -- "$BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage
EOS
  echo "VNC 已就绪：在手机上装 VNC Viewer / bVNC，连 127.0.0.1:5900"
  echo "连上后先登录 WorkBuddy，登录完成后按 Ctrl+C 退出本命令，再执行 ./wb-proot.sh token"
  proot-distro login "$DISTRO" -- bash /root/start.sh
}

do_token() {
  need_termux
  [ -d "$ROOTFS/etc" ] || die "容器还没装好，先运行 ./wb-proot.sh"
  [ -f "$MARK" ] || die "WorkBuddy 还没装完，先运行 ./wb-proot.sh"
  [ -f "$HOME/wb-token.js" ] || die "缺少 wb-token.js，请先把它放到 $HOME/wb-token.js"

  cp "$HOME/wb-token.js" "$ROOTFS/root/wb-token.js" || die "复制 wb-token.js 失败"

  step "在容器内以 Node 模式运行客户端，取出 token"
  proot-distro login "$DISTRO" -- bash -lc \
    'BIN=$(cat /opt/.wb-bin 2>/dev/null); [ -x "${BIN:-}" ] || BIN=/opt/WorkBuddy/workbuddy; ELECTRON_RUN_AS_NODE=1 "$BIN" /root/wb-token.js'

  if [ -s "$ROOTFS/root/wb-token.txt" ]; then
    step "取到的凭证（在 Termux 里执行 ./workbuddy.sh import 后粘贴这一行）"
    cat "$ROOTFS/root/wb-token.txt"
  else
    warn "没有生成 wb-token.txt。可能还没登录，或客户端版本与解密方式不匹配，把上面的输出发我。"
  fi
}

do_stop() {
  need_termux
  [ -d "$ROOTFS/etc" ] || die "容器不存在"
  proot-distro login "$DISTRO" -- bash -lc \
    'pkill -f workbuddy 2>/dev/null; pkill -x x11vnc 2>/dev/null; pkill -x Xvfb 2>/dev/null; true'
  echo "已关闭 WorkBuddy / x11vnc / Xvfb"
}

case "${1:-install}" in
  install|run) do_install ;;
  token)       do_token ;;
  stop)        do_stop ;;
  shell)       need_termux; proot-distro login "$DISTRO" ;;
  *) echo "用法: $0 [install|token|stop|shell]"; exit 1 ;;
esac
