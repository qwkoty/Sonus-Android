#!/data/data/com.termux/files/usr/bin/bash
# 清理 wb3.sh 建出来的第三个用户（名字叫 WB3 的用户全部删掉）
# 用法: bash ~/wb3-clean.sh
set -uo pipefail

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

S() {
  if command -v rish >/dev/null 2>&1; then
    rish -c "$1" </dev/null 2>&1
  elif command -v adb >/dev/null 2>&1 && [ -n "${TARGET:-}" ]; then
    adb -s "$TARGET" shell "$1" 2>&1 | tr -d '\r'
  else
    adb shell "$1" 2>&1 | tr -d '\r'
  fi
}

step "当前用户列表"
USERS=$(S 'pm list users')
printf '%s\n' "$USERS"

IDS=$(printf '%s\n' "$USERS" | sed -n 's/.*UserInfo{\([0-9][0-9]*\):\(WB3\|IslandWB\)[:}].*/\1/p')

if [ -z "$IDS" ]; then
  info "没有找到名为 WB3 / IslandWB 的用户，无需清理。"
  exit 0
fi

step "删除用户"
for id in $IDS; do
  info "正在删除用户 $id ..."
  out=$(S "pm remove-user $id")
  if printf '%s' "$out" | grep -qiE 'success|removed'; then
    info "  已删除 $id"
  else
    bad "  删除 $id 失败：$out"
    warn "  如果提示正在使用，先切回主空间： rish -c 'am switch-user 0'"
  fi
done

step "清理后"
S 'pm list users'
info "完成。主空间的 WorkBuddy 不受影响。"
