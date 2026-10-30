#!/data/data/com.termux/files/usr/bin/bash
# ══════════════════════════════════════════════════════════════
#  Qoder 手机版签到（Termux 单文件自包含）
#  ─────────────────────────────────────────────────────────────
#  用法：
#    bash qoder.sh            首次运行=扫码登录并签到；之后=直接签到
#    bash qoder.sh login      重新登录（换账号 / 令牌失效）
#    bash qoder.sh checkin    只签到（可加 --wait 一直等到领到为止）
#    bash qoder.sh auto       安装每日 10:05 自动签到
#    bash qoder.sh auto off   关闭自动签到
#    bash qoder.sh status     查看账号与最近结果
#  说明：除首次自动安装 Python 外，不下载任何依赖。
# ══════════════════════════════════════════════════════════════
set -u

APP_DIR="$HOME/.qoder-checkin"
mkdir -p "$APP_DIR"

SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
export QODER_SELF="$SELF"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[首次运行] 正在安装 Python（只这一次，之后完全离线可用）..."
  pkg update -y >/dev/null 2>&1 || true
  if ! pkg install -y python; then
    echo "安装 Python 失败。请手动执行： pkg install python"
    exit 1
  fi
fi

cat > "$APP_DIR/app.py" <<'PYCODE'
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qoder 每日签到（国内版/国际版）· 设备码登录 + 自动领 Credits"""
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

APP_DIR = os.path.join(os.path.expanduser("~"), ".qoder-checkin")
ACC_FILE = os.path.join(APP_DIR, "account.json")
LOG_FILE = os.path.join(APP_DIR, "checkin.log")
BJT = timezone(timedelta(hours=8))

SITES = {
    "cn": {"web": "https://qoder.cn",
           "openapi": "https://openapi.qoder.com.cn",
           "client_id": "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
           "name": "Qoder 国内版"},
    "intl": {"web": "https://qoder.com",
             "openapi": "https://openapi.qoder.sh",
             "client_id": "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
             "name": "Qoder 国际版"},
}

CAMP_PATH = "/sash/api/v1/me/campaigns"
CLAIM_PATH = "/sash/api/v1/me/campaigns/{cid}/claim"


# ── 基础工具 ──────────────────────────────────────────────
def now_bj():
    return datetime.now(BJT)


def log(msg):
    line = "[%s] %s" % (now_bj().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def b64u(raw):
    import base64
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _parse(raw):
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text)
    except ValueError:
        return text


def req(base, path, method="GET", token=None, body=None, query=None):
    url = base.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    headers = {"Accept": "application/json", "User-Agent": "Qoder", "Cosy-ClientType": "10"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, _parse(resp.read())
    except urllib.error.HTTPError as err:
        try:
            return err.code, _parse(err.read())
        except Exception:
            return err.code, ""
    except Exception as err:
        return 0, str(err)


def expires_of(payload):
    for key in ("expire_time", "expires_at"):
        val = payload.get(key) if isinstance(payload, dict) else None
        if val is None:
            continue
        if isinstance(val, (int, float)) or str(val).isdigit():
            num = float(val)
            return num / 1000 if num > 1e11 else num
        try:
            return datetime.fromisoformat(str(val).replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    val = payload.get("expires_in") if isinstance(payload, dict) else None
    if isinstance(val, (int, float)) and val > 0:
        return time.time() + float(val)
    return 0


def open_url(url):
    for cmd in (["am", "start", "-a", "android.intent.action.VIEW", "-d", url],
                ["termux-open-url", url]):
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            return True
        except Exception:
            continue
    return False


# ── 登录（Qoder 官方设备码流程）─────────────────────────────
def login(site_key="cn"):
    site = SITES.get(site_key) or SITES["cn"]
    verifier = b64u(secrets.token_bytes(64))
    challenge = b64u(hashlib.sha256(verifier.encode()).digest())
    nonce = str(uuid.uuid4())
    machine_id = str(uuid.uuid4())
    query = {"challenge": challenge, "challenge_method": "S256",
             "nonce": nonce, "machine_id": machine_id,
             "client_id": site["client_id"]}
    url = site["web"] + "/device/selectAccounts?" + urllib.parse.urlencode(query)

    print()
    print("=" * 58)
    print("  登录 %s" % site["name"])
    print("=" * 58)
    print("  浏览器里登录并点「授权」后，这里会自动继续。")
    if site_key == "intl":
        print("  ⚠️ 国际版领取需要 Qoder 桌面端生成的设备指纹，手机上可能查不到活动。")
    print("  如果没自动弹出浏览器，请手动复制下面的链接打开：")
    print()
    print("  " + url)
    print()
    open_url(url)

    deadline = time.time() + 15 * 60
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        status, data = req(site["openapi"], "/api/v1/deviceToken/poll",
                           query={"nonce": nonce, "verifier": verifier,
                                  "challenge_method": "S256"})
        if status == 200 and isinstance(data, dict) and str(data.get("token") or "").strip():
            token = str(data["token"]).strip()
            refresh = str(data.get("refresh_token") or data.get("refreshToken") or "").strip()
            uid = str(data.get("user_id") or data.get("uid") or "").strip()
            name = str(data.get("user_name") or data.get("nickname") or "").strip()

            status2, info = req(site["openapi"], "/api/v1/userinfo", token=token)
            if status2 == 200 and isinstance(info, dict):
                uid = uid or str(info.get("id") or info.get("user_id") or info.get("uid") or "")
                name = name or str(info.get("name") or info.get("nickname") or info.get("email") or "")

            account = {"site": site_key, "token": token, "refresh": refresh,
                       "expires": expires_of(data), "uid": uid, "name": name,
                       "machine_id": machine_id}
            _save_json(ACC_FILE, account)
            print()
            log("✅ 登录成功：%s" % (name or uid or "已授权账号"))
            return account
        if attempt % 15 == 0:
            print("  ...等待授权中（%d 秒）" % int(attempt * 2))
        time.sleep(2)

    print()
    log("❌ 登录超时（15 分钟），请重新运行：bash qoder.sh login")
    return None


# ── 令牌刷新 ────────────────────────────────────────────
def refresh_token(account):
    site = SITES.get(account.get("site", "cn"), SITES["cn"])
    refresh = str(account.get("refresh") or "").strip()
    if not refresh:
        return False
    status, data = req(site["openapi"], "/api/v1/deviceToken/refresh",
                       method="POST", body={"refresh_token": refresh})
    if status != 200 or not isinstance(data, dict):
        log("⚠️ 刷新登录态失败（HTTP %s）：%s" % (status, str(data)[:100]))
        return False
    token = str(data.get("token") or data.get("device_token") or "").strip()
    new_refresh = str(data.get("refresh_token") or data.get("refreshToken") or "").strip()
    if not token or not new_refresh:
        log("⚠️ 刷新登录态返回不完整")
        return False
    account.update({"token": token, "refresh": new_refresh, "expires": expires_of(data)})
    _save_json(ACC_FILE, account)
    return True


def ensure_token(account):
    exp = float(account.get("expires") or 0)
    if account.get("token") and (not exp or exp - time.time() > 60):
        return True
    return refresh_token(account)


# ── 签到 ────────────────────────────────────────────────
def _fmt_amount(val):
    try:
        return "{:,.0f}".format(float(val))
    except (TypeError, ValueError):
        return str(val)


def checkin_once(account):
    site = SITES.get(account.get("site", "cn"), SITES["cn"])
    if not ensure_token(account):
        return "login_required", "登录已失效，请运行 bash qoder.sh login", 0

    status, data = req(site["openapi"], CAMP_PATH, token=account["token"])
    if status == 401:
        if refresh_token(account):
            status, data = req(site["openapi"], CAMP_PATH, token=account["token"])
    if status == 401:
        return "login_required", "登录已失效，请运行 bash qoder.sh login", 0
    if status != 200 or not isinstance(data, dict):
        return "error", "查询失败 HTTP %s: %s" % (status, str(data)[:100]), 0

    campaigns = data.get("campaigns")
    campaigns = campaigns if isinstance(campaigns, list) else []
    benefits = [c for c in campaigns if isinstance(c, dict) and c.get("actionType") == "CLAIM_BENEFIT"]
    claimable = [c for c in benefits if c.get("claimStatus") == "CLAIMABLE"]

    if not benefits:
        return "pending", "今天活动还没下发（一般 10:00 之后放出）", 0

    if claimable:
        total, failed = 0.0, 0
        for camp in claimable:
            cid = str(camp.get("campaignId") or "")
            s2, d2 = req(site["openapi"], CLAIM_PATH.replace("{cid}", cid),
                         method="POST", token=account["token"], body={})
            detail = d2.get("data") if isinstance(d2, dict) and isinstance(d2.get("data"), dict) else d2
            ok = s2 == 200 and isinstance(detail, dict) and detail.get("status") == "CLAIMED"
            if ok:
                amount = ((detail.get("benefit") or {}).get("amount")
                          or (camp.get("benefit") or {}).get("amount") or 0)
                try:
                    total += float(amount)
                except (TypeError, ValueError):
                    pass
            else:
                failed += 1
        if failed:
            return "error", "%d/%d 个活动领取失败" % (failed, len(claimable)), total
        return "claimed", "签到成功 +%s Credits" % _fmt_amount(total), total

    claimed = [c for c in benefits if c.get("claimStatus") == "CLAIMED"
               and float(c.get("startAt") or 0) <= time.time() < float(c.get("endAt") or 0)]
    if claimed:
        return "already", "今日已领取", 0
    return "pending", "活动未下发，稍后会自动再试", 0


LABELS = {"claimed": "✅ 签到成功", "already": "☑️ 今日已领",
          "pending": "⏳ 待下发", "login_required": "🔑 需登录", "error": "❌ 失败"}


def do_checkin(wait=False, account=None):
    account = account or _load_json(ACC_FILE)
    if not account:
        print("还没有账号，先登录。")
        account = login("cn")
        if not account:
            return 2

    tries = 0
    while True:
        tries += 1
        phase, msg, credits = checkin_once(account)
        label = LABELS.get(phase, phase)
        full = "%s：%s" % (label, msg)
        log("%s（%s）" % (full, account.get("name") or account.get("uid") or "账号"))

        if phase in ("claimed", "already"):
            return 0
        if phase in ("login_required", "error"):
            return 2
        if not wait or tries >= 8:
            return 3
        if now_bj().hour >= 22:
            log("今天不再重试，明天自动继续。")
            return 3
        log("20 分钟后再试一次……")
        time.sleep(20 * 60)


# ── 自动签到 ────────────────────────────────────────────
def _boot_hook_path():
    return os.path.join(os.path.expanduser("~"), ".termux", "boot", "90-qoder-checkin.sh")


def _daemon_pid():
    try:
        with open(os.path.join(APP_DIR, "daemon.pid"), encoding="utf-8") as fh:
            pid = int(fh.read().strip())
    except (OSError, ValueError):
        return 0
    try:
        os.kill(pid, 0)
        return pid
    except OSError:
        return 0


def _daemon_running():
    return _daemon_pid() > 0


def start_daemon():
    self_path = os.environ.get("QODER_SELF", "")
    if not self_path or not os.path.isfile(self_path):
        print("找不到脚本自身路径，无法启动守护进程。请在脚本所在目录运行。")
        return
    target = os.path.join(APP_DIR, "qoder.sh")
    if os.path.abspath(self_path) != os.path.abspath(target):
        try:
            with open(self_path, encoding="utf-8") as src, open(target, "w", encoding="utf-8") as dst:
                dst.write(src.read())
            os.chmod(target, 0o755)
        except OSError as err:
            print("复制脚本失败：%s" % err)
            return
    if _daemon_running():
        print("自动签到已经在运行。")
        return
    subprocess.Popen(["bash", target, "daemon"], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    print("已启动后台自动签到（每天 10:05 北京时间）。")


def cmd_auto(on=True):
    hook = _boot_hook_path()
    if on:
        os.makedirs(os.path.dirname(hook), exist_ok=True)
        with open(hook, "w", encoding="utf-8") as fh:
            fh.write("#!/data/data/com.termux/files/usr/bin/sh\n"
                     "termux-wake-lock 2>/dev/null\n"
                     'nohup bash "$HOME/.qoder-checkin/qoder.sh" daemon '
                     '>>"$HOME/.qoder-checkin/daemon.out" 2>&1 &\n')
        print("已写入开机自启：%s" % hook)
        print("（这行需要安装 Termux:Boot 才会在开机时生效；不装也不影响手动运行。）")
        start_daemon()
    else:
        try:
            os.remove(hook)
            print("已移除开机自启。")
        except FileNotFoundError:
            print("开机自启本来就没装。")
        pid = _daemon_pid()
        if pid:
            try:
                os.kill(pid, 15)
                print("已停止后台自动签到。")
            except OSError:
                pass
        try:
            os.remove(os.path.join(APP_DIR, "daemon.pid"))
        except OSError:
            pass


def daemon():
    pidfile = os.path.join(APP_DIR, "daemon.pid")
    try:
        with open(pidfile, "w", encoding="utf-8") as fh:
            fh.write(str(os.getpid()))
    except OSError:
        pass
    log("后台自动签到已启动。")
    try:
        while True:
            now = now_bj()
            target = now.replace(hour=10, minute=5, second=0, microsecond=0)
            if now >= target:
                target += timedelta(days=1)
            log("下次签到：%s" % target.strftime("%Y-%m-%d %H:%M"))
            time.sleep((target - now).total_seconds())
            account = _load_json(ACC_FILE)
            if account:
                do_checkin(wait=True, account=account)
            time.sleep(60)
    finally:
        try:
            os.remove(pidfile)
        except OSError:
            pass


# ── 状态 ────────────────────────────────────────────────
def cmd_status():
    account = _load_json(ACC_FILE)
    print()
    print("=" * 58)
    print("  Qoder 签到状态")
    print("=" * 58)
    if not account:
        print("  未登录。运行：bash qoder.sh login")
        return 0
    site = SITES.get(account.get("site", "cn"), SITES["cn"])
    exp = float(account.get("expires") or 0)
    print("  站点    : %s" % site["name"])
    print("  账号    : %s" % (account.get("name") or "（未命名）"))
    print("  UID     : %s" % (account.get("uid") or "-"))
    print("  令牌到期: %s" % (datetime.fromtimestamp(exp, BJT).strftime("%Y-%m-%d %H:%M")
                          if exp else "未知（按失效自动刷新）"))
    print("  自动签到: %s" % ("开" if _daemon_running() else "关"))
    print()
    print("  最近日志：")
    try:
        with open(LOG_FILE, encoding="utf-8") as fh:
            for line in fh.readlines()[-6:]:
                print("   " + line.rstrip())
    except OSError:
        print("   （暂无）")
    return 0


# ── 入口 ────────────────────────────────────────────────
def usage():
    print("用法：")
    print("  bash qoder.sh             登录（首次）/ 立即签到")
    print("  bash qoder.sh login       重新登录")
    print("  bash qoder.sh checkin     只签到（--wait 一直等到领到）")
    print("  bash qoder.sh auto        开启每天 10:05 自动签到")
    print("  bash qoder.sh auto off    关闭自动签到")
    print("  bash qoder.sh status      查看状态")


def main(argv):
    cmd = argv[0] if argv else "run"

    if cmd in ("help", "-h", "--help"):
        usage()
        return 0
    if cmd == "login":
        site = argv[1] if len(argv) > 1 and argv[1] in SITES else "cn"
        return 0 if login(site) else 1
    if cmd == "checkin":
        return do_checkin(wait="--wait" in argv)
    if cmd == "auto":
        cmd_auto(on=not ("off" in argv or "stop" in argv))
        return 0
    if cmd == "status":
        return cmd_status()
    if cmd == "daemon":
        daemon()
        return 0
    if cmd == "run":
        account = _load_json(ACC_FILE)
        if not account:
            account = login("cn")
            if not account:
                return 1
        return do_checkin(account=account)
    usage()
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        print("\n已取消。")
        sys.exit(130)
PYCODE

exec python3 -u "$APP_DIR/app.py" "$@"
