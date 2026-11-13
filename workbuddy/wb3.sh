#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy 第三份（Android 原生多用户 / 工作资料）一键脚本
#
# 用法:
#   bash wb3.sh              一键：建工作资料 → 装 WorkBuddy → 打印切换命令
#   bash wb3.sh list         看现有用户
#   bash wb3.sh switch 12    切到某个用户（0 = 主空间）
#   bash wb3.sh install 12   给已存在的用户 12 装 WorkBuddy
#
# 前提：Shizuku 已用无线调试启动，并且 rish 可用（脚本会自动尝试下载 rish）
set -uo pipefail

NAME="WB3"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

# 通过 rish 以 shell 身份执行一条命令
S() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 90 rish <<EOF
$1
EOF
  else
    rish <<EOF
$1
EOF
  fi
}

ensure_rish() {
  if command -v rish >/dev/null 2>&1; then return 0; fi
  warn "没找到 rish，尝试下载到 $PREFIX_DIR/bin"
  mkdir -p "$PREFIX_DIR/bin"
  if curl -fsSL -m 60 -o "$PREFIX_DIR/bin/rish" \
      https://raw.githubusercontent.com/RikkaApps/Shizuku/master/rish; then
    chmod +x "$PREFIX_DIR/bin/rish"
    info "rish 已下载"
    return 0
  fi
  bad "rish 下载失败（GitHub 连不上）"
  info "请手动处理：打开 Shizuku App → 菜单 →「在终端中使用 rish」，按提示操作"
  return 1
}

check_shizuku() {
  local id
  id=$(S 'id') || true
  if printf '%s' "$id" | grep -q 'uid=2000'; then
    info "Shizuku 正常（shell 权限已拿到）"
    return 0
  fi
  bad "拿不到 shell 权限，rish 输出如下："
  printf '%s\n' "$id" | tail -8
  warn "先在 Shizuku App 里用「无线调试」启动服务，再重跑本脚本"
  return 1
}

find_pkg() {
  local pkgs
  pkgs=$(S 'pm list packages' | sed 's/^package://' | tr -d '\r' | grep -iE 'workbuddy|codebuddy|buddy' | sort -u)
  if [ -z "$pkgs" ]; then
    bad "没找到 WorkBuddy 的包名"
    info "在应用里确认 WorkBuddy 已经装在主空间，或者在命令后面直接给包名："
    info "  bash ~/wb3.sh install <用户id> <包名>"
    return 1
  fi
  printf '%s\n' "$pkgs" | head -5 >&2
  printf '%s\n' "$pkgs" | grep -i 'workbuddy' | head -1
}

new_user() {
  local out uid
  # 先按原生「工作资料」建，失败再退化成普通多用户
  out=$(S "pm create-user --profileOf 0 --managed $NAME")
  uid=$(printf '%s' "$out" | grep -oE 'id [0-9]+' | grep -oE '[0-9]+' | head -1)
  if [ -n "${uid:-}" ]; then
    info "已创建工作资料，用户 id=$uid"
    printf '%s\n' "$uid"
    return 0
  fi
  warn "工作资料建不了（系统限制），改用普通多用户"
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
    info "已为用户 $uid 安装 $pkg"
    return 0
  fi
  out=$(S "cmd package install-existing --user $uid $pkg")
  if printf '%s' "$out" | grep -qi 'installed'; then
    info "已为用户 $uid 安装 $pkg"
    return 0
  fi
  bad "安装到用户 $uid 失败："
  printf '%s\n' "$out" | tail -5
  return 1
}

do_list() {
  step "现有用户"
  S 'pm list users'
}

do_switch() {
  local uid="${1:-}"
  [ -n "$uid" ] || { bad "用法: bash ~/wb3.sh switch <用户id>"; return 1; }
  step "切换到用户 $uid"
  S "am switch-user $uid"
  info "已切换。回主空间: bash ~/wb3.sh switch 0"
}

do_install() {
  local uid="${1:-}" pkg="${2:-}"
  [ -n "$uid" ] || { bad "用法: bash ~/wb3.sh install <用户id> [包名]"; return 1; }
  if [ -z "$pkg" ]; then
    pkg=$(find_pkg) || return 1
  fi
  info "包名: $pkg"
  install_for "$uid" "$pkg"
}

one_click() {
  ensure_rish || return 1
  check_shizuku || return 1

  step "1/3 找 WorkBuddy"
  PKG=$(find_pkg) || return 1
  info "包名: $PKG"

  step "2/3 建第三个用户"
  UID3=$(new_user) || return 1
  UID3=$(printf '%s\n' "$UID3" | tail -1)

  step "3/3 给用户 $UID3 装 WorkBuddy"
  install_for "$UID3" "$PKG" || return 1

  echo ""
  echo "================================================================"
  echo " 完成，第三份 WorkBuddy 已在用户 $UID3 里"
  echo ""
  echo " 切过去: bash ~/wb3.sh switch $UID3"
  echo " 回主屏: bash ~/wb3.sh switch 0"
  echo " 看用户: bash ~/wb3.sh list"
  echo ""
  echo " 如果桌面图标没出现，看看桌面里有没有「工作」页签，"
  echo " 或重启一次手机让工作资料生效。"
  echo "================================================================"
}

case "${1:-}" in
  ""|all|run) one_click ;;
  list) ensure_rish && check_shizuku && do_list ;;
  switch) shift; ensure_rish && check_shizuku && do_switch "${1:-}" ;;
  install) shift; ensure_rish && check_shizuku && do_install "${1:-}" "${2:-}" ;;
  *) echo "用法: $0 [list|switch <id>|install <id> [包名]]"; exit 1 ;;
esac
