#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy 手机端部署（国内镜像版，不需要 root，不碰 Docker Hub / proot-distro）
#
# 用法:
#   bash wb.sh              一键：下 rootfs → 装客户端 → VNC 登录 → 取 token → 签到 → 开每日自动
#   bash wb.sh token        token 过期后重新取
#   bash wb.sh checkin      手动签到
#   bash wb.sh status       查看状态
#   bash wb.sh auto [off]   开关每日自动签到
#   bash wb.sh stop         关闭图形界面
set -uo pipefail

APP="$HOME/.wb"
ROOT="$HOME/.wb-root"
MARK="$ROOT/root/.wb-ok"
INFO_FILE="$ROOT/root/.config/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"
WAIT=1500
MIRROR_BASE="https://mirrors.tuna.tsinghua.edu.cn/lxc-images/images/debian/bookworm"
ARCH_PATH="arm64"

step() { printf "\n\033[1;36m===== %s =====\033[0m\n" "$1"; }
info() { printf "%s\n" "$1"; }
warn() { printf "\033[1;33m[提示] %s\033[0m\n" "$1"; }
bad()  { printf "\033[1;31m[失败] %s\033[0m\n" "$1"; }

detect_arch() {
  case "$(uname -m)" in
    aarch64|arm64) ARCH_PATH="arm64" ;;
    x86_64|amd64)  ARCH_PATH="amd64" ;;
    *) bad "这个架构 ($(uname -m)) 不支持，需要用 64 位 Termux"; return 1 ;;
  esac
}

# 统一入口：在 rootfs 里以 root 身份执行命令
RUN() {
  proot --link2symlink -0 -r "$ROOT" \
    -b /dev -b /proc -b /sys \
    -w /root \
    /usr/bin/env -i \
      HOME=/root TERM=xterm-256color LANG=C.UTF-8 \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      "$@"
}

mkdir -p "$APP"

# ---------- 内嵌: 取 token 的 JS（在客户端进程内运行） ----------
write_token_js() {
cat > "$APP/wb-token.js" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const REL=['CodeBuddyExtension','Data','Public','auth','workbuddy-desktop.info'];
function find(){
  const home=process.env.HOME||process.env.USERPROFILE||'',l=[];
  if(process.env.LOCALAPPDATA)l.push(path.join(process.env.LOCALAPPDATA,...REL));
  if(process.env.APPDATA)l.push(path.join(process.env.APPDATA,...REL));
  if(home){l.push(path.join(home,'Library','Application Support',...REL));l.push(path.join(home,'.config',...REL));}
  for(const p of l){try{if(fs.existsSync(p))return p;}catch(e){}}
  return null;
}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0,0);return b;}
function lp(s){const b=Buffer.from(String(s),'utf8');return Buffer.concat([u32(b.length),b]);}
function aad(k,s){return Buffer.concat([Buffer.from('WB-AAD\0','utf8'),Buffer.from([1]),lp('WBEV1'),lp('sym-v1'),u32(s),lp(k),Buffer.from([2,0,0])]);}
function key(){
  const m=process._linkedBinding('electron_browser_workbuddy_storage');
  let r=m.loggerGet();if(Buffer.isBuffer(r))r=r.toString('utf8');
  const o=JSON.parse(r);if(!o||!o.atRestSecretKey)throw new Error('no atRestSecretKey');
  return crypto.createHash('sha256').update(String(o.atRestSecretKey),'utf8').digest();
}
function dec(env,k){
  const o=JSON.parse(Buffer.from(env,'base64').toString('utf8'));
  const d=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(o.nonce,'base64'));
  d.setAuthTag(Buffer.from(o.authTag,'base64'));
  d.setAAD(aad(o.keyId,o.suite));
  return Buffer.concat([d.update(Buffer.from(o.ciphertext,'base64')),d.final()]).toString('utf8');
}
function juid(t){
  try{const o=JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
  for(const k of ['uid','userId','user_id','sub','accountId'])if(o[k])return String(o[k]);}catch(e){}
  return '';
}
const f=find();
if(!f){console.error('找不到登录态文件，请先在 VNC 里完成登录');process.exit(2);}
const c=JSON.parse(fs.readFileSync(f,'utf8')),a=c.auth||c;
let t=a.accessToken;
if(!t){console.error('没有 accessToken');process.exit(3);}
if(typeof t==='object'){if(!t.envelope){console.error('accessToken 格式不认识');process.exit(4);}t=dec(t.envelope,key());}
const dom=String(a.domain||c.domain||'www.workbuddy.cn');
let u=a.uid||a.userId||a.user_id||(a.user&&(a.user.uid||a.user.id))||'';
u=u?String(u):juid(t);
const blob='WB1.'+Buffer.from(JSON.stringify({d:dom,t:t,u:u}),'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+/g,'');
console.log(blob);
JS
}

# ---------- 内嵌: 手机端签到程序 ----------
write_app_py() {
cat > "$APP/app.py" <<'PY'
import base64, datetime, json, os, signal, subprocess, sys, time
import urllib.error, urllib.request

APP = os.path.join(os.environ.get("HOME", "."), ".wb")
TOK = os.path.join(APP, "token.json")
LOG = os.path.join(APP, "checkin.log")
PID = os.path.join(APP, "daemon.pid")
DOM = "www.workbuddy.cn"


def log(m):
    line = "[%s] %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), m)
    print(line, flush=True)
    try:
        os.makedirs(APP, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load():
    try:
        with open(TOK, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save(o):
    os.makedirs(APP, exist_ok=True)
    with open(TOK, "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False)
    try:
        os.chmod(TOK, 0o600)
    except Exception:
        pass


def jwt(t):
    try:
        s = t.split(".")[1]
        s += "=" * (-len(s) % 4)
        return json.loads(base64.urlsafe_b64decode(s.encode()).decode())
    except Exception:
        return {}


def api(acct, path):
    dom = (acct.get("domain") or DOM).replace("https://", "").replace("http://", "").strip().rstrip("/")
    req = urllib.request.Request(
        "https://" + dom + path,
        data=b"{}",
        method="POST",
        headers={
            "Authorization": "Bearer " + str(acct.get("accessToken") or ""),
            "Content-Type": "application/json",
            "X-User-Id": str(acct.get("uid") or ""),
            "Accept": "application/json",
            "User-Agent": "WorkBuddy",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def checkin():
    acct = load()
    if not acct or not acct.get("accessToken"):
        log("还没导入凭证，先运行： ./wb.sh token")
        return 2
    if not acct.get("uid"):
        acct["uid"] = str(jwt(acct["accessToken"]).get("uid") or "")
        save(acct)
    st, data = api(acct, "/v2/billing/meter/daily-checkin")
    code = data.get("code") if isinstance(data, dict) else None
    if st == 401:
        log("凭证已失效，需要重新取 token： ./wb.sh token")
        return 3
    if st == 200 and code == 0:
        log("签到成功，今日积分已领取。")
        return 0
    if code == 10001:
        log("今天已经签到过了。")
        return 0
    log("签到未成功：HTTP %s  %s" % (st, json.dumps(data, ensure_ascii=False)))
    return 1


def do_import(blob):
    blob = (blob or "").strip()
    if not blob:
        print("粘贴 WB1. 开头的那一行：", flush=True)
        blob = sys.stdin.readline()
    if blob.startswith("WB1."):
        blob = blob[4:]
    blob = blob.replace("\n", "").replace("\r", "").replace(" ", "")
    blob += "=" * (-len(blob) % 4)
    o = json.loads(base64.urlsafe_b64decode(blob.encode()).decode())
    acct = {"domain": o.get("d") or DOM, "accessToken": o.get("t") or "", "uid": str(o.get("u") or "")}
    if not acct["accessToken"]:
        log("凭证里没有 token")
        return 1
    if not acct["uid"]:
        acct["uid"] = str(jwt(acct["accessToken"]).get("uid") or "")
    save(acct)
    exp = jwt(acct["accessToken"]).get("exp")
    when = datetime.datetime.fromtimestamp(int(exp)).strftime("%Y-%m-%d") if exp else "未知"
    log("凭证已导入，到期约 %s" % when)
    return 0


def read_pid():
    try:
        with open(PID, "r") as f:
            return int(f.read().strip())
    except Exception:
        return 0


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def status():
    acct = load()
    if not acct:
        log("状态：未导入凭证")
        return 1
    exp = jwt(acct.get("accessToken", "")).get("exp")
    log("域名：%s  uid：%s" % (acct.get("domain"), acct.get("uid") or "(空)"))
    log("token 到期：%s" % (datetime.datetime.fromtimestamp(int(exp)).strftime("%Y-%m-%d") if exp else "未知"))
    pid = read_pid()
    log("自动签到：%s" % ("运行中 (PID %d)" % pid if pid and alive(pid) else "未开启"))
    return 0


def auto_on():
    pid = read_pid()
    if pid and alive(pid):
        log("自动签到已经在运行 (PID %d)" % pid)
        return 0
    try:
        os.remove(PID)
    except Exception:
        pass
    p = subprocess.Popen([sys.executable, "-u", os.path.abspath(__file__), "daemon"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, cwd=APP)
    log("已开启自动签到（PID %d），每天 00:05" % p.pid)
    return 0


def auto_off():
    pid = read_pid()
    if pid and alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
        log("已关闭自动签到 (PID %d)" % pid)
    else:
        log("自动签到当前没有运行")
    try:
        os.remove(PID)
    except Exception:
        pass
    return 0


def daemon():
    with open(PID, "w") as f:
        f.write(str(os.getpid()))
    log("守护进程启动 (PID %d)，每天 00:05 自动签到" % os.getpid())
    try:
        while True:
            now = datetime.datetime.now()
            t = now.replace(hour=0, minute=5, second=0, microsecond=0)
            if now >= t:
                t += datetime.timedelta(days=1)
            log("下次签到：%s" % t.strftime("%Y-%m-%d %H:%M"))
            time.sleep(max(1, (t - now).total_seconds()))
            checkin()
            time.sleep(90)
    finally:
        try:
            os.remove(PID)
        except Exception:
            pass


cmd = sys.argv[1] if len(sys.argv) > 1 else "checkin"
if cmd == "checkin":
    sys.exit(checkin())
elif cmd == "import":
    sys.exit(do_import(" ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""))
elif cmd == "status":
    sys.exit(status())
elif cmd == "auto":
    sys.exit(auto_off() if len(sys.argv) > 2 and sys.argv[2] in ("off", "stop", "0") else auto_on())
elif cmd == "daemon":
    sys.exit(daemon())
else:
    print("用法: app.py [checkin|import|status|auto [off]|daemon]")
    sys.exit(1)
PY
}

ensure_python() {
  if ! command -v python3 >/dev/null 2>&1; then
    pkg install -y python || pkg install -y python3 || { bad "Python 安装失败"; return 1; }
  fi
}

ensure_tools() {
  local miss=""
  command -v proot >/dev/null 2>&1 || miss="$miss proot"
  command -v curl >/dev/null 2>&1 || miss="$miss curl"
  command -v xz >/dev/null 2>&1 || miss="$miss xz-utils"
  [ -z "$miss" ] && return 0
  info "安装 Termux 依赖:$miss"
  pkg install -y $miss || { bad "依赖安装失败"; return 1; }
}

bin_path() { cat "$ROOT/opt/.wb-bin" 2>/dev/null; }

stop_gui() {
  if [ -x "$ROOT/bin/bash" ]; then
    RUN bash -lc 'pkill -f workbuddy 2>/dev/null; pkill -x x11vnc 2>/dev/null; pkill -x Xvfb 2>/dev/null; true' >/dev/null 2>&1
  fi
  if [ -f "$APP/gui.pid" ]; then
    p=$(cat "$APP/gui.pid" 2>/dev/null)
    [ -n "${p:-}" ] && kill "$p" 2>/dev/null
    rm -f "$APP/gui.pid"
  fi
}

latest_snapshot() {
  curl -sS -m 25 "$MIRROR_BASE/$ARCH_PATH/default/" \
    | tr '<' '\n' | grep -oE '[0-9]{8}_[0-9]{2}:[0-9]{2}' | sort -u | tail -1
}

fetch_rootfs() {
  local ts dir url i
  ts="${WB_TS:-}"
  [ -n "$ts" ] || ts=$(latest_snapshot)
  [ -n "$ts" ] || { bad "取不到镜像列表（网络不通？）"; return 1; }
  dir="$MIRROR_BASE/$ARCH_PATH/default/$ts"
  url="$dir/rootfs.tar.xz"
  info "镜像: $url"
  for i in 1 2 3; do
    if curl -fL --retry 3 -m 1800 -o "$APP/rootfs.tar.xz" "$url"; then return 0; fi
    warn "下载失败，重试 $i"
    sleep 3
  done
  return 1
}

extract_rootfs() {
  [ -s "$APP/rootfs.tar.xz" ] || { bad "rootfs 文件为空"; return 1; }
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  info "解压中，约 300MB，请稍等..."
  if ! tar -xf "$APP/rootfs.tar.xz" -C "$ROOT" 2>/dev/null; then
    warn "tar 直接解压失败，改用 xz 解一层"
    xz -dc "$APP/rootfs.tar.xz" > "$APP/rootfs.tar" || { bad "xz 解压失败"; return 1; }
    tar -xf "$APP/rootfs.tar" -C "$ROOT" || { bad "tar 解包失败"; return 1; }
    rm -f "$APP/rootfs.tar"
  fi
  [ -x "$ROOT/bin/bash" ] || { bad "解压后没有 /bin/bash，镜像可能不完整"; return 1; }
  mkdir -p "$ROOT/root" "$ROOT/etc/apt"
  printf 'nameserver 114.114.114.114\nnameserver 223.5.5.5\n' > "$ROOT/etc/resolv.conf"
  cat > "$ROOT/etc/apt/sources.list" <<'EOS'
deb http://mirrors.tuna.tsinghua.edu.cn/debian bookworm main contrib non-free non-free-firmware
deb http://mirrors.tuna.tsinghua.edu.cn/debian bookworm-updates main contrib non-free non-free-firmware
deb http://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware
EOS
  rm -f "$ROOT"/etc/apt/sources.list.d/*.list 2>/dev/null || true
  rm -f "$APP/rootfs.tar.xz"
}

install_all() {
  step "0/6 环境检查"
  command -v pkg >/dev/null 2>&1 || { bad "必须在 Termux 里运行"; exit 1; }
  detect_arch || exit 1
  termux-wake-lock 2>/dev/null || warn "拿不到 wake-lock，安装期间请插电、别锁屏"
  info "剩余空间："; df -h "$HOME" | tail -1
  ensure_python || exit 1
  ensure_tools || exit 1

  if [ -x "$ROOT/bin/bash" ] && [ -f "$MARK" ]; then
    info "已装过 WorkBuddy，跳过下载与安装"
    return 0
  fi

  if [ ! -x "$ROOT/bin/bash" ]; then
    step "1/6 下载 Debian 根文件系统（国内镜像）"
    fetch_rootfs || { bad "下载失败，检查网络后重跑"; exit 1; }
    step "2/6 解压并初始化"
    extract_rootfs || exit 1
    info "rootfs 就绪：$ROOT"
  else
    info "复用已有 rootfs：$ROOT"
  fi

  step "3/6 容器内安装 WorkBuddy（最慢，请耐心）"
  cat > "$ROOT/root/install.sh" <<'EOS'
set -u
export DEBIAN_FRONTEND=noninteractive
apt-get update || { echo "[容器] apt update 失败"; exit 1; }
BASE="wget ca-certificates procps dbus dbus-x11 xvfb x11vnc fonts-noto-cjk xdg-utils xz-utils"
apt-get install -y --no-install-recommends $BASE || apt-get install -y $BASE || true
LIBS="libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 libsecret-1-0 \
libgbm1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
libcairo2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libpulse0 libegl1 libgles2 libx11-xcb1"
if ! apt-get install -y --no-install-recommends $LIBS; then
  echo "[容器] 整组失败，逐个尝试（兼容 xxx-t64 改名）"
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
  echo "  下载失败，重试 $i"; sleep 3
done
[ "$ok" = "1" ] && [ -s /tmp/wb.deb ] || { echo "[容器] deb 下载失败"; exit 1; }
dpkg -i /tmp/wb.deb || apt-get -f install -y || true
BIN=""
for c in /opt/WorkBuddy/workbuddy /opt/workbuddy/workbuddy /usr/bin/workbuddy /usr/share/workbuddy/workbuddy; do
  [ -x "$c" ] && BIN="$c" && break
done
[ -n "$BIN" ] || BIN=$(find /opt /usr -maxdepth 3 -name workbuddy -type f -perm -u+x 2>/dev/null | head -1)
[ -n "$BIN" ] || { echo "[容器] 没找到可执行文件"; ls -la /opt; exit 1; }
echo "$BIN" > /opt/.wb-bin
touch /root/.wb-ok
echo "[容器] 完成: $BIN"
EOS
  RUN bash /root/install.sh || { bad "容器内安装失败，看上面报错"; exit 1; }
}

start_gui() {
  step "4/6 启动虚拟桌面"
  cat > "$ROOT/root/start.sh" <<'EOS'
set -u
export DISPLAY=:1
pidof Xvfb >/dev/null 2>&1 || { Xvfb :1 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pidof x11vnc >/dev/null 2>&1 || { x11vnc -display :1 -forever -nopw -shared -rfbport 5900 -localhost >/tmp/vnc.log 2>&1 & sleep 1; }
BIN=$(cat /opt/.wb-bin 2>/dev/null)
[ -x "${BIN:-}" ] || BIN=/opt/WorkBuddy/workbuddy
exec dbus-run-session -- "$BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage
EOS
  stop_gui
  sleep 1
  nohup proot --link2symlink -0 -r "$ROOT" -b /dev -b /proc -b /sys -w /root \
    /usr/bin/env -i HOME=/root TERM=xterm-256color LANG=C.UTF-8 \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      bash /root/start.sh >"$APP/gui.log" 2>&1 &
  echo $! > "$APP/gui.pid"
  sleep 8
  echo ""
  echo "================================================================"
  echo " 用手机上的 VNC 客户端（bVNC / VNC Viewer）连接："
  echo "     地址 127.0.0.1    端口 5900"
  echo " 连上后在 WorkBuddy 窗口里登录。脚本会自动检测并继续。"
  echo "================================================================"
}

wait_login() {
  step "5/6 等待登录"
  local w=0
  while [ "$w" -lt "$WAIT" ]; do
    if [ -s "$INFO_FILE" ]; then
      info "检测到登录状态，继续。"
      sleep 3
      return 0
    fi
    sleep 5
    w=$((w + 5))
    [ $((w % 30)) -eq 0 ] && info "已等 $((w / 60)) 分 $((w % 60)) 秒……请在 VNC 里登录"
  done
  warn "等待超时。窗口还开着，登录完可以单独运行： bash wb.sh token"
  return 1
}

get_token() {
  step "取凭证"
  [ -x "$ROOT/bin/bash" ] || { bad "rootfs 还没准备好"; return 1; }
  [ -s "$INFO_FILE" ] || { bad "还没检测到登录，先登录"; return 1; }
  write_token_js
  cp "$APP/wb-token.js" "$ROOT/root/wb-token.js" || { bad "复制脚本失败"; return 1; }
  stop_gui
  sleep 2
  BIN=$(bin_path)
  OUT=$(RUN bash -lc "BIN='${BIN:-/opt/WorkBuddy/workbuddy}'; ELECTRON_RUN_AS_NODE=1 \"\$BIN\" /root/wb-token.js" 2>&1)
  BLOB=$(printf '%s\n' "$OUT" | grep -m1 '^WB1\.' | tr -d '\r')
  if [ -z "$BLOB" ]; then
    bad "没取到凭证，客户端输出如下："
    printf '%s\n' "$OUT"
    return 1
  fi
  printf '%s\n' "$BLOB" > "$APP/token.txt"
  return 0
}

all_flow() {
  write_app_py
  write_token_js
  install_all
  start_gui
  wait_login || return 1
  get_token || return 1
  step "6/6 导入并开启自动签到"
  python3 -u "$APP/app.py" import "$(cat "$APP/token.txt")"
  python3 -u "$APP/app.py" checkin
  python3 -u "$APP/app.py" auto
  echo ""
  echo "================================================================"
  echo " 完成。以后每天 00:05 自动签到，不需要再开 VNC。"
  echo " 状态: bash wb.sh status      手动签: bash wb.sh checkin"
  echo " token 约 55 天后过期，届时运行: bash wb.sh token"
  echo "================================================================"
}

case "${1:-all}" in
  all|install|run|"") all_flow ;;
  token) write_token_js; get_token && step "导入" && python3 -u "$APP/app.py" import "$(cat "$APP/token.txt")" ;;
  checkin) ensure_python && write_app_py && python3 -u "$APP/app.py" checkin ;;
  status) ensure_python && write_app_py && python3 -u "$APP/app.py" status ;;
  auto) ensure_python && write_app_py && python3 -u "$APP/app.py" auto "${2:-}" ;;
  stop) stop_gui; info "已关闭图形界面" ;;
  *) echo "用法: $0 [all|token|checkin|status|auto [off]|stop]"; exit 1 ;;
esac
