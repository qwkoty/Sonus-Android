#!/data/data/com.termux/files/usr/bin/bash
# 把主空间正在用的输入法，一键装进工作资料（Island「壶中界」）并设为默认
#
# 用法:
#   bash ~/ime.sh          一键设置
#   bash ~/ime.sh list     只看主空间/工作资料当前输入法
#   bash ~/ime.sh fix      重新设置一遍（同默认）
set -uo pipefail

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

# rish 调命令，遇到 Shizuku 超时自动重试
R() {
  local cmd="$1" i out
  for i in 1 2 3 4 5 6; do
    out=$(timeout 30 rish -c "$cmd" </dev/null 2>&1)
    case "$out" in
      *"Request timeout"*|*"Request canceled"*|*"connection"*blocked*)
        sleep 1
        continue ;;
    esac
    printf '%s' "$out"
    return 0
  done
  return 1
}

# 清掉 \r 和首尾空白
trim() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

command -v rish >/dev/null 2>&1 || { bad "没找到 rish，先在 Shizuku 里授权 Termux 并按官方教程装 rish"; exit 1; }
if ! R 'id' | grep -q 'uid=2000'; then
  bad "rish 连不上（Shizuku 可能没启动或被系统冻结），打开 Shizuku 启动后再试"
  exit 1
fi
info "shell 权限正常"

find_uid3() {
  local users ids x
  users=$(R 'pm list users')
  ids=$(printf '%s\n' "$users" | sed -n 's/.*UserInfo{\([0-9][0-9]*\):.*/\1/p')
  for x in $ids; do
    case "$x" in 0|999) ;; *) printf '%s' "$x"; return 0 ;; esac
  done
  return 1
}

UID3=$(find_uid3) || { bad "没找到工作资料（除主空间和应用双开外的用户）。先跑 bash ~/wb3-island.sh"; exit 1; }
MAIN_IME=$(trim "$(R 'settings get secure default_input_method')")
[ -n "$MAIN_IME" ] || { bad "主空间没设默认输入法"; exit 1; }

case "${1:-run}" in
  list)
    step "主空间（用户 0）"
    info "输入法: $MAIN_IME"
    step "工作资料（用户 $UID3）"
    info "输入法: $(trim "$(R "settings --user $UID3 get secure default_input_method")")"
    step "工作资料里已装的输入法"
    R "ime list -a -s --user $UID3" | sed 's/^/  /'
    exit 0 ;;
esac

PKG="${MAIN_IME%%/*}"

step "1/4 主空间输入法"
info "$MAIN_IME"
info "包名: $PKG"

step "2/4 装进工作资料（用户 $UID3）"
OUT=$(R "pm install-existing --user $UID3 $PKG")
info "$OUT"
printf '%s' "$OUT" | grep -qi 'installed' || warn "安装输出异常，继续尝试启用"

step "3/4 启用"
info "$(R "ime enable --user $UID3 $MAIN_IME")"

step "4/4 设为默认"
info "$(R "ime set --user $UID3 $MAIN_IME")"

NOW=$(trim "$(R "settings --user $UID3 get secure default_input_method")")
if [ "$NOW" = "$MAIN_IME" ]; then
  printf '\n\033[1;32m[成功] 工作资料已使用同一款输入法：%s\033[0m\n' "$NOW"
else
  warn "现在是: ${NOW:-空}"
  bad "没设置成功。把上面的输出发我"
  exit 1
fi
info "去工作资料点任意输入框即可，词库不共享（各自独立）。"
info "看状态： bash ~/ime.sh list"
