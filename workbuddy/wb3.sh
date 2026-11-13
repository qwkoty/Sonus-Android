#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy 第三份（Android 原生多用户 / 工作资料）一键脚本
# 通过 Termux 自带的 adb 连本机无线调试，拿 shell 权限，不需要 root、不需要电脑
#
# 用法:
#   bash wb3.sh              一键：连 adb → 建工作资料 → 装 WorkBuddy → 打印切换命令
#   bash wb3.sh connect      重新配对/连接（重启手机后要重连）
#   bash wb3.sh list         看现有用户
#   bash wb3.sh switch 12    切到某个用户（0 = 主空间）
#   bash wb3.sh install 12   给已存在的用户装 WorkBuddy
#   bash wb3.sh remove 12    删掉某个用户
set -uo pipefail

NAME="WB3"
STATE="$HOME/.wb3-adb"
TARGET=""

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

MODE=""   # rish | adb

# 以 shell 身份执行一条命令
S() {
  if [ "$MODE" = "rish" ]; then
    if command -v timeout >/dev/null 2>&1; then
      timeout 90 rish -c "$1" 2>&1
    else
      rish -c "$1" 2>&1
    fi
  elif [ -n "$TARGET" ]; then
    adb -s "$TARGET" shell "$1" 2>&1 | tr -d '\r'
  else
    adb shell "$1" 2>&1 | tr -d '\r'
  fi
}

# 优先用 rish（Shizuku），不行再走 adb 无线调试
try_rish() {
  command -v rish >/dev/null 2>&1 || return 1
  local out
  if command -v timeout >/dev/null 2>&1; then
    out=$(timeout 60 rish -c 'id' 2>&1) || true
  else
    out=$(rish -c 'id' 2>&1) || true
  fi
  if printf '%s' "$out" | grep -q 'uid=2000'; then
    MODE=rish
    info "已通过 rish 连上（Shizuku）"
    return 0
  fi
  return 1
}

connect_any() {
  info "检查 rish（Shizuku）..."
  if try_rish; then return 0; fi
  if ! command -v rish >/dev/null 2>&1; then
    bad "没找到 rish，先运行： bash ~/rish.sh"
  else
    warn "rish 连不上（Shizuku 可能没启动），改用 adb 无线调试"
  fi
  MODE=adb
  do_connect
}

ensure_adb() {
  if command -v adb >/dev/null 2>&1; then return 0; fi
  info "正在安装 android-tools（提供 adb，只需一次，可能要一两分钟）..."
  pkg install -y android-tools
  command -v adb >/dev/null 2>&1 || { bad "adb 安装失败，手动执行： pkg install android-tools"; return 1; }
}

connected() {
  [ -n "${1:-}" ] || return 1
  adb devices 2>/dev/null | grep -q "^$1[[:space:]]*device$"
}

restore_state() {
  [ -f "$STATE" ] || return 0
  local t; t=$(cat "$STATE" 2>/dev/null)
  [ -n "${t:-}" ] || return 0
  if connected "$t"; then TARGET="$t"; return 0; fi
  adb connect "$t" >/dev/null 2>&1
  if connected "$t"; then TARGET="$t"; fi
}

do_connect() {
  step "连接本机无线调试"
  ensure_adb || return 1

  restore_state
  if [ -n "$TARGET" ]; then
    info "已连接：$TARGET"
    return 0
  fi

  cat <<'TIP'
请先在手机上打开：
  设置 → 关于手机 → 连点「版本号」7 次开启开发者选项
  设置 → 系统 → 开发者选项 → 无线调试（打开）

然后点「无线调试」→「使用配对码配对设备」，屏幕上会显示：
  配对码 6 位数字
  IP 地址和端口（例如 192.168.1.5:37281）

下面先输入「配对」用的端口和配对码。
TIP
  printf "配对端口: "; read -r PPORT
  printf "配对码  : "; read -r PCODE
  [ -n "${PPORT:-}" ] && [ -n "${PCODE:-}" ] || { bad "没输入配对信息"; return 1; }

  adb pair "127.0.0.1:$PPORT" "$PCODE" || \
    adb pair "$PPORT" "$PCODE" || { bad "配对失败，检查端口/配对码是否正确"; return 1; }

  local CPORT
  printf "回到「无线调试」主页面，输入那里显示的端口（IP 后面那串数字）: "; read -r CPORT
  [ -n "${CPORT:-}" ] || { bad "没输入端口"; return 1; }

  adb connect "127.0.0.1:$CPORT" >/dev/null 2>&1
  if ! connected "127.0.0.1:$CPORT"; then
    bad "连接失败，稍等几秒后重跑： bash ~/wb3.sh connect"
    adb devices
    return 1
  fi
  TARGET="127.0.0.1:$CPORT"
  printf '%s\n' "$TARGET" > "$STATE"
  info "已连接：$TARGET"
}

check_shell() {
  local id
  id=$(S 'id')
  if printf '%s' "$id" | grep -q 'uid=2000'; then
    info "shell 权限正常"
    return 0
  fi
  bad "拿不到 shell 权限，返回："
  printf '%s\n' "$id" | tail -6
  warn "重新配对： bash ~/wb3.sh connect"
  return 1
}

find_pkg() {
  local pkgs
  pkgs=$(S 'pm list packages' | sed 's/^package://' | grep -iE 'workbuddy|codebuddy' | sort -u)
  if [ -z "$pkgs" ]; then
    bad "没找到 WorkBuddy 包名（主空间要先装好 WorkBuddy）"
    return 1
  fi
  printf '%s\n' "$pkgs" | sed 's/^/  发现: /' >&2
  printf '%s\n' "$pkgs" | head -1
}

new_user() {
  local out uid
  info "正在创建工作资料，等系统返回（最多 90 秒）..."
  out=$(S "pm create-user --profileOf 0 --managed $NAME")
  uid=$(printf '%s' "$out" | grep -oE 'id [0-9]+' | grep -oE '[0-9]+' | head -1)
  if [ -n "${uid:-}" ]; then
    info "已创建工作资料，用户 id=$uid"
    printf '%s\n' "$uid"
    return 0
  fi
  warn "工作资料建不了，改用普通多用户"
  printf '%s\n' "$out" | tail -3

  out=$(S "pm create-user $NAME")
  uid=$(printf '%s' "$out" | grep -oE 'id [0-9]+' | grep -oE '[0-9]+' | head -1)
  if [ -n "${uid:-}" ]; then
    info "已创建用户，id=$uid"
    printf '%s\n' "$uid"
    return 0
  fi
  bad "建用户失败，系统返回："
  printf '%s\n' "$out" | tail -5
  return 1
}

install_for() {
  local uid="$1" pkg="$2" out
  out=$(S "pm install-existing --user $uid $pkg")
  if printf '%s' "$out" | grep -qi 'installed'; then
    info "已为用户 $uid 安装 $pkg"; return 0
  fi
  out=$(S "cmd package install-existing --user $uid $pkg")
  if printf '%s' "$out" | grep -qi 'installed'; then
    info "已为用户 $uid 安装 $pkg"; return 0
  fi
  bad "安装到用户 $uid 失败："; printf '%s\n' "$out" | tail -5; return 1
}

do_list()   { step "现有用户"; S 'pm list users'; }

do_switch() {
  [ -n "${1:-}" ] || { bad "用法: bash ~/wb3.sh switch <用户id>"; return 1; }
  step "切换到用户 $1"
  S "am switch-user $1"
  info "已切换。回主空间： bash ~/wb3.sh switch 0"
}

do_remove() {
  [ -n "${1:-}" ] || { bad "用法: bash ~/wb3.sh remove <用户id>"; return 1; }
  step "删除用户 $1"
  S "pm remove-user $1"
}

do_install() {
  local uid="${1:-}" pkg="${2:-}"
  [ -n "$uid" ] || { bad "用法: bash ~/wb3.sh install <用户id> [包名]"; return 1; }
  if [ -z "$pkg" ]; then pkg=$(find_pkg) || return 1; fi
  info "包名: $pkg"
  install_for "$uid" "$pkg"
}

one_click() {
  connect_any || return 1
  check_shell || return 1

  step "1/3 找 WorkBuddy"
  local pkg; pkg=$(find_pkg) || return 1
  info "包名: $pkg"

  step "2/3 建第三个用户"
  local uid3; uid3=$(new_user) || return 1
  uid3=$(printf '%s\n' "$uid3" | tail -1)

  step "3/3 给用户 $uid3 装 WorkBuddy"
  install_for "$uid3" "$pkg" || return 1

  echo ""
  echo "================================================================"
  echo " 完成，第三份 WorkBuddy 已在用户 $uid3"
  echo ""
  echo " 切过去: bash ~/wb3.sh switch $uid3"
  echo " 回主屏: bash ~/wb3.sh switch 0"
  echo " 看用户: bash ~/wb3.sh list"
  echo ""
  echo " 桌面没看到图标就重启一次手机；工作资料通常带公文包角标。"
  echo " 手机重启后无线调试会关，重新打开再执行: bash ~/wb3.sh connect"
  echo "================================================================"
}

case "${1:-}" in
  ""|all|run) one_click ;;
  connect)    do_connect ;;
  list)       connect_any >/dev/null && check_shell && do_list ;;
  switch)     shift; connect_any >/dev/null && check_shell && do_switch "${1:-}" ;;
  install)    shift; connect_any >/dev/null && check_shell && do_install "${1:-}" "${2:-}" ;;
  remove)     shift; connect_any >/dev/null && check_shell && do_remove "${1:-}" ;;
  *) echo "用法: $0 [connect|list|switch <id>|install <id> [包名]|remove <id>]"; exit 1 ;;
esac
