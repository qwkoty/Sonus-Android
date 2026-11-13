#!/data/data/com.termux/files/usr/bin/bash
# 用 Island（工作资料）把 WorkBuddy 变成「主空间里的第三个图标」
# 前提：Island 已安装；Shizuku 正在运行；rish 可用
# 用法:
#   bash ~/wb3-island.sh          一键创建
#   bash ~/wb3-island.sh check    查看工作资料状态
set -uo pipefail

DPC_PKG="com.oasisfeng.island"
DPC_CMP="com.oasisfeng.island/.IslandDeviceAdminReceiver"
WB_PKG="${WB_PKG:-com.tencent.workbuddy.app}"
PROFILE_NAME="IslandWB"

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

S() { rish -c "$1" </dev/null 2>&1; }

command -v rish >/dev/null 2>&1 || {
  bad "没找到 rish，先运行： bash ~/rish.sh"
  exit 1
}
if ! S 'id' | grep -q 'uid=2000'; then
  bad "rish 连不上，先打开 Shizuku 启动服务"
  exit 1
fi
info "shell 权限正常"

step "0/5 检查 Island"
if ! S "pm list packages $DPC_PKG" | grep -q "$DPC_PKG"; then
  bad "Island 还没装。先下载安装（浏览器打开或 curl），装好后再跑本脚本："
  info "  curl -sS -X POST -o ~/island.apk https://temp.sh/LjFDc/island.apk"
  info "  然后手动安装 ~/island.apk（或 rish -c 'pm install -r /sdcard/Download/island.apk'）"
  exit 1
fi
info "Island 已安装"

case "${1:-}" in
  check)
    step "工作资料状态"
    S 'pm list users'
    S "pm list packages --user 0 | grep -c ." >/dev/null
    info ""
    info "带公文包角标的 WorkBuddy 图标即第三份；没出现就重启一次手机。"
    exit 0 ;;
esac

step "1/5 清掉旧的临时用户"
USERS=$(S 'pm list users')
OLD_IDS=$(printf '%s\n' "$USERS" | sed -n 's/.*UserInfo{\([0-9][0-9]*\):\(WB3\|IslandWB\)[:}].*/\1/p')
if [ -n "$OLD_IDS" ]; then
  for id in $OLD_IDS; do
    info "删除旧用户 $id ..."
    S "pm remove-user $id" | tail -1
  done
else
  info "没有需要清理的旧用户"
fi

step "2/5 创建工作资料"
OUT=$(S "pm create-user --profileOf 0 --managed $PROFILE_NAME")
printf '%s\n' "$OUT"
UID3=$(printf '%s' "$OUT" | sed -n 's/.*user id \([0-9][0-9]*\).*/\1/p')
if [ -z "$UID3" ]; then
  bad "建不出工作资料，多半是小米系统限制。改用手机分身+双开凑到 3 个。"
  exit 1
fi
info "新工作资料用户 id = $UID3"

step "3/5 把 Island 装进工作资料"
S "pm install-existing --user $UID3 $DPC_PKG" | tail -2

step "4/5 激活工作资料（设为设备管理）"
DP=$(S "dpm set-profile-owner --user $UID3 $DPC_CMP" 2>&1)
printf '%s\n' "$DP" | tail -3
if ! printf '%s' "$DP" | grep -qiE 'success|active'; then
  bad "激活失败，工作资料可能无法启动。把上面输出发我。"
fi

step "5/5 装 WorkBuddy"
S "pm install-existing --user $UID3 $WB_PKG" | tail -2
S "pm list packages --user $UID3 | grep -i workbuddy" || warn "没查到，可能包名不同"

printf '\n\033[1;32m%s\033[0m\n' "================================================"
info "完成。第三份用户在 id=$UID3"
info "回到桌面，会看到一个带公文包角标的 WorkBuddy 图标，点开登录第三个账号。"
info "没看到图标：重启一次手机；或打开 Island 点「启动工作资料」。"
info "如果提示工作资料已暂停，打开 Island 取消暂停。"
info "查看状态： bash ~/wb3-island.sh check"
info "删掉它：   bash ~/wb3-clean.sh   （会删 IslandWB 用户）"
printf '\033[1;32m%s\033[0m\n' "================================================"
