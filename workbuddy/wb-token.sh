#!/data/data/com.termux/files/usr/bin/bash
# 单独取 WorkBuddy token 并导入（不关闭虚拟屏，适合多账号切换）
# 用法: bash wb-token.sh
set -uo pipefail

APP="$HOME/.wb"
ROOT="$HOME/.wb-root"
LOADER="/lib/ld-linux-aarch64.so.1"
LIBPATH="/usr/lib/aarch64-linux-gnu:/usr/lib"
L2S="--link2symlink"

case "$(uname -m)" in
  aarch64|arm64) ;;
  x86_64|amd64) LOADER="/lib64/ld-linux-x86-64.so.2"; LIBPATH="/usr/lib/x86_64-linux-gnu:/usr/lib:/lib32" ;;
  *) echo "[失败] 不支持的架构"; exit 1 ;;
esac

RUN() {
  env -u LD_PRELOAD proot $L2S -0 -r "$ROOT" \
    -b /dev -b /proc -b /sys -w /root \
    "$LOADER" --library-path "$LIBPATH" \
    /usr/bin/env -i HOME=/root TERM=xterm-256color LANG=C.UTF-8 \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}

[ -x "$ROOT/bin/bash" ] || { echo "[失败] 还没安装好，先运行 bash ~/wb.sh"; exit 1; }
[ -f "$APP/app.py" ]   || { echo "[失败] 缺少 ~/.wb/app.py，先运行 bash ~/wb.sh"; exit 1; }
RUN true >/dev/null 2>&1 || { L2S=""; RUN true >/dev/null 2>&1 || { echo "[失败] 容器启动不了"; exit 1; }; }

cat > "$APP/wb-token.js" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const REL=['CodeBuddyExtension','Data','Public','auth','workbuddy-desktop.info'];
function find(){
  const home=process.env.HOME||process.env.USERPROFILE||'',l=[];
  if(process.env.LOCALAPPDATA)l.push(path.join(process.env.LOCALAPPDATA,...REL));
  if(process.env.APPDATA)l.push(path.join(process.env.APPDATA,...REL));
  if(home){l.push(path.join(home,'Library','Application Support',...REL));l.push(path.join(home,'.config',...REL));}
  for(const p of l){try{if(fs.existsSync(p))return p;}catch(e){}}
  function walk(d,dep){
    if(dep>7)return null;
    let es=[];try{es=fs.readdirSync(d,{withFileTypes:true});}catch(e){return null;}
    for(const e of es){if(e.isFile()&&e.name==='workbuddy-desktop.info')return path.join(d,e.name);}
    for(const e of es){if(e.isDirectory()){const r=walk(path.join(d,e.name),dep+1);if(r)return r;}}
    return null;
  }
  for(const r of [home,'/root','/home']){if(r){const p=walk(r,0);if(p)return p;}}
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
cp "$APP/wb-token.js" "$ROOT/root/wb-token.js" || { echo "[失败] 复制脚本失败"; exit 1; }

BIN=$(cat "$ROOT/opt/.wb-bin" 2>/dev/null)
[ -n "${BIN:-}" ] || BIN=/opt/WorkBuddy/workbuddy

echo "===== 取凭证 ====="
OUT=$(RUN bash -lc "ELECTRON_RUN_AS_NODE=1 \"$BIN\" /root/wb-token.js" 2>&1)
BLOB=$(printf '%s\n' "$OUT" | grep -m1 '^WB1\.' | tr -d '\r')
if [ -z "$BLOB" ]; then
  echo "[失败] 没取到凭证，客户端输出如下："
  printf '%s\n' "$OUT"
  exit 1
fi
printf '%s\n' "$BLOB" > "$APP/token.txt"

echo "===== 导入 ====="
python3 -u "$APP/app.py" import "$BLOB"
