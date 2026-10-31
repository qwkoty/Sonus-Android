#!/data/data/com.termux/files/usr/bin/bash
# WorkBuddy 手机端每日签到（单文件自包含）
set -u
APP_DIR="$HOME/.workbuddy-checkin"
mkdir -p "$APP_DIR"
SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
export WB_SELF="$SELF"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[首次运行] 正在安装 Python（只这一次）..."
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y python || { echo "安装 Python 失败。请手动执行： pkg install python"; exit 1; }
fi

cat > "$APP_DIR/app.py" <<'PYCODE'
import base64, datetime, json, os, signal, subprocess, sys, time
import urllib.error, urllib.request

APP_DIR = os.path.join(os.environ.get("HOME", "."), ".workbuddy-checkin")
TOKEN_FILE = os.path.join(APP_DIR, "token.json")
LOG_FILE = os.path.join(APP_DIR, "checkin.log")
PID_FILE = os.path.join(APP_DIR, "daemon.pid")
DEFAULT_DOMAIN = "www.workbuddy.cn"


def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = "[%s] %s" % (ts, msg)
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_token():
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_token(obj):
    os.makedirs(APP_DIR, exist_ok=True)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except Exception:
        pass


def jwt_payload(token):
    try:
        seg = token.split(".")[1]
        seg += "=" * (-len(seg) % 4)
        return json.loads(base64.urlsafe_b64decode(seg.encode()).decode())
    except Exception:
        return {}


def jwt_uid(token):
    obj = jwt_payload(token)
    for k in ("uid", "userId", "user_id", "sub", "accountId"):
        if obj.get(k):
            return str(obj[k])
    return ""


def jwt_exp(token):
    obj = jwt_payload(token)
    try:
        return int(obj.get("exp") or 0)
    except Exception:
        return 0


def parse_blob(text):
    text = (text or "").strip()
    if text.startswith("WB1."):
        text = text[4:]
    text = text.replace("\n", "").replace("\r", "").replace(" ", "")
    text += "=" * (-len(text) % 4)
    obj = json.loads(base64.urlsafe_b64decode(text.encode()).decode())
    return {
        "domain": obj.get("d") or DEFAULT_DOMAIN,
        "accessToken": obj.get("t") or "",
        "uid": str(obj.get("u") or ""),
    }


def api(acct, path, body=b"{}"):
    dom = (acct.get("domain") or DEFAULT_DOMAIN)
    dom = dom.replace("https://", "").replace("http://", "").strip().rstrip("/")
    url = "https://" + dom + path
    headers = {
        "Authorization": "Bearer " + str(acct.get("accessToken") or ""),
        "Content-Type": "application/json",
        "X-User-Id": str(acct.get("uid") or ""),
        "Accept": "application/json",
        "User-Agent": "WorkBuddy",
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
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


def do_checkin():
    acct = load_token()
    if not acct or not acct.get("accessToken"):
        log("还没有导入凭证。先运行： ./workbuddy.sh import")
        return 2
    if not acct.get("uid"):
        acct["uid"] = jwt_uid(acct["accessToken"])
        save_token(acct)

    status, data = api(acct, "/v2/billing/meter/daily-checkin")
    code = data.get("code") if isinstance(data, dict) else None

    if status == 401:
        log("凭证已失效（登录态过期）。需要回电脑重新取一次 token 再导入。")
        return 3
    if status == 200 and code == 0:
        log("签到成功，今日积分已领取。")
        return 0
    if code == 10001:
        log("今天已经签到过了，无需重复。")
        return 0
    log("签到未成功：HTTP %s，返回 %s" % (status, json.dumps(data, ensure_ascii=False)))
    return 1


def do_import(text):
    if not text:
        print("把电脑上 wb.bat 输出的那一行（WB1. 开头）粘进来，然后回车：", flush=True)
        text = sys.stdin.readline()
    try:
        acct = parse_blob(text)
    except Exception as e:
        log("凭证解析失败：%s" % e)
        return 1
    if not acct.get("accessToken"):
        log("凭证里没有有效 token，请重新复制。")
        return 1
    if not acct.get("uid"):
        acct["uid"] = jwt_uid(acct["accessToken"])
    save_token(acct)
    exp = jwt_exp(acct["accessToken"])
    when = datetime.datetime.fromtimestamp(exp).strftime("%Y-%m-%d") if exp else "未知"
    log("凭证已导入。域名 %s，uid %s，token 到期约 %s" % (acct["domain"], acct["uid"] or "(空)", when))
    return 0


def do_status():
    acct = load_token()
    if not acct or not acct.get("accessToken"):
        log("状态：未导入凭证（先运行 ./workbuddy.sh import）")
        return 1
    exp = jwt_exp(acct["accessToken"])
    when = datetime.datetime.fromtimestamp(exp).strftime("%Y-%m-%d %H:%M") if exp else "未知"
    log("域名：%s" % acct.get("domain"))
    log("uid：%s" % (acct.get("uid") or "(空)"))
    log("token 到期：%s" % when)
    pid = read_pid()
    if pid and pid_alive(pid):
        log("自动签到：运行中（PID %d）" % pid)
    else:
        log("自动签到：未开启（关闭终端或重启后需要重新执行 ./workbuddy.sh auto）")
    log("日志文件：%s" % LOG_FILE)
    return 0


def read_pid():
    try:
        with open(PID_FILE, "r") as f:
            return int(f.read().strip())
    except Exception:
        return 0


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def auto_on():
    pid = read_pid()
    if pid and pid_alive(pid):
        log("自动签到已经在运行（PID %d）" % pid)
        return 0
    try:
        os.remove(PID_FILE)
    except Exception:
        pass
    sub = subprocess.Popen(
        [sys.executable, "-u", os.path.abspath(__file__), "daemon"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        cwd=APP_DIR,
    )
    log("已启动后台守护进程（PID %d），每天 00:05 自动签到。" % sub.pid)
    return 0


def auto_off():
    pid = read_pid()
    if not pid or not pid_alive(pid):
        log("自动签到当前没有运行。")
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        return 0
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass
    try:
        os.remove(PID_FILE)
    except Exception:
        pass
    log("已停止自动签到（PID %d）。" % pid)
    return 0


def daemon():
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))
    log("守护进程已启动（PID %d），每天 00:05 自动签到。" % os.getpid())
    try:
        while True:
            now = datetime.datetime.now()
            target = now.replace(hour=0, minute=5, second=0, microsecond=0)
            if now >= target:
                target += datetime.timedelta(days=1)
            log("下次签到时间：%s" % target.strftime("%Y-%m-%d %H:%M"))
            time.sleep(max(1, (target - now).total_seconds()))
            do_checkin()
            time.sleep(90)
    finally:
        try:
            os.remove(PID_FILE)
        except Exception:
            pass


def usage():
    print("""用法: ./workbuddy.sh <命令>

  import            导入电脑上取到的凭证（粘贴 WB1. 那一行）
  checkin           立即签到一次
  status            查看凭证状态和自动签到状态
  auto              开启每天 00:05 自动签到（后台守护）
  auto off          关闭自动签到
  daemon            前台运行守护进程（一般不用手动执行）
  run               默认：已导入就签到，未导入就提示导入
""")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "run"
    if cmd == "import":
        return do_import(" ".join(args[1:]) if len(args) > 1 else "")
    if cmd == "checkin":
        return do_checkin()
    if cmd == "status":
        return do_status()
    if cmd == "auto":
        if len(args) > 1 and args[1] in ("off", "stop", "0"):
            return auto_off()
        return auto_on()
    if cmd == "daemon":
        return daemon()
    if cmd in ("run", ""):
        acct = load_token()
        if not acct or not acct.get("accessToken"):
            return do_import("")
        return do_checkin()
    if cmd in ("help", "-h", "--help"):
        usage()
        return 0
    usage()
    return 1


if __name__ == "__main__":
    sys.exit(main())
PYCODE

exec python3 -u "$APP_DIR/app.py" "$@"
