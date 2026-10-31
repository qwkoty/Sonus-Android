// wb-token.js
// 用途：在 WorkBuddy 桌面客户端内以 Electron 的 Node 模式运行，
//      取出被加密的 accessToken，输出一行可直接导入手机的凭证串（WB1.xxx）。
// 用法（Windows）：双击 wb.bat
// 用法（手动）：set ELECTRON_RUN_AS_NODE=1 && "C:\...\WorkBuddy.exe" wb-token.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INFO_NAME = 'workbuddy-desktop.info';
const REL_PARTS = ['CodeBuddyExtension', 'Data', 'Public', 'auth', INFO_NAME];

function infoCandidates() {
  const list = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, ...REL_PARTS));
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, ...REL_PARTS));
  if (home) list.push(path.join(home, 'Library', 'Application Support', ...REL_PARTS));
  if (home) list.push(path.join(home, '.config', ...REL_PARTS));
  return list;
}

function findInfo() {
  for (const p of infoCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) { /* ignore */ }
  }
  return null;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function lp(s) {
  const b = Buffer.from(String(s), 'utf8');
  return Buffer.concat([u32(b.length), b]);
}

function buildAAD(keyId, suite) {
  return Buffer.concat([
    Buffer.from('WB-AAD\0', 'utf8'),
    Buffer.from([1]),
    lp('WBEV1'),
    lp('sym-v1'),
    u32(suite),
    lp(keyId),
    Buffer.from([2, 0, 0]),
  ]);
}

function getSecretKey() {
  let mod;
  try {
    mod = process._linkedBinding('electron_browser_workbuddy_storage');
  } catch (e) {
    throw new Error('无法加载原生模块 electron_browser_workbuddy_storage（必须用 WorkBuddy 自带的可执行文件、并设置 ELECTRON_RUN_AS_NODE=1 运行）');
  }
  let raw = mod.loggerGet();
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  const obj = JSON.parse(String(raw));
  if (!obj || !obj.atRestSecretKey) throw new Error('loggerGet() 没有返回 atRestSecretKey');
  return crypto.createHash('sha256').update(String(obj.atRestSecretKey), 'utf8').digest();
}

function decryptEnvelope(envelopeB64, key) {
  const meta = JSON.parse(Buffer.from(envelopeB64, 'base64').toString('utf8'));
  const nonce = Buffer.from(meta.nonce, 'base64');
  const tag = Buffer.from(meta.authTag, 'base64');
  const cipher = Buffer.from(meta.ciphertext, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  d.setAuthTag(tag);
  d.setAAD(buildAAD(meta.keyId, meta.suite));
  return Buffer.concat([d.update(cipher), d.final()]).toString('utf8');
}

function uidFromJwt(token) {
  try {
    const seg = token.split('.')[1];
    const obj = JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    for (const k of ['uid', 'userId', 'user_id', 'sub', 'accountId']) {
      if (obj[k]) return String(obj[k]);
    }
  } catch (e) { /* ignore */ }
  return '';
}

function b64url(str) {
    const b = Buffer.from(str, 'utf8');
    return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\/+/g, '_').replace(/=+/g, '');
}

function main() {
  const info = findInfo();
  if (!info) {
    console.error('找不到登录态文件 workbuddy-desktop.info');
    console.error('请先在 WorkBuddy 客户端里登录一次，再运行本脚本。');
    process.exit(2);
  }

  const conf = JSON.parse(fs.readFileSync(info, 'utf8'));
  const auth = conf.auth || conf;
  let token = auth.accessToken;

  if (!token) {
    console.error('登录态里没有 accessToken，可能还没登录成功。');
    process.exit(3);
  }

  if (typeof token === 'object') {
    if (!token.envelope) {
      console.error('accessToken 是对象但没有 envelope 字段，格式无法识别。');
      process.exit(4);
    }
    token = decryptEnvelope(token.envelope, getSecretKey());
  }

  if (typeof token !== 'string' || !token) {
    console.error('解密得到的 accessToken 为空。');
    process.exit(5);
  }

  const domain = String(auth.domain || conf.domain || 'www.workbuddy.cn');
  let uid = auth.uid || auth.userId || auth.user_id || (auth.user && (auth.user.uid || auth.user.id)) || '';
  uid = uid ? String(uid) : uidFromJwt(token);

  const payload = { d: domain, t: token, u: uid };
  const blob = 'WB1.' + b64url(JSON.stringify(payload));

  const outFile = path.join(__dirname, 'wb-token.txt');
  try { fs.writeFileSync(outFile, blob + '\n', 'utf8'); } catch (e) { /* ignore */ }

  console.log('');
  console.log('=== 复制下面这一整行（已同时保存为同目录的 wb-token.txt）===');
  console.log('');
  console.log(blob);
  console.log('');
  console.log('=== 复制到上面这一行结束 ===');
  console.log('');
  console.error('[信息] 登录态文件: ' + info);
  console.error('[信息] 接口域名: ' + domain + '  uid: ' + (uid || '(空，将自动从 token 读取)'));
  console.error('[信息] token 前 20 字符: ' + token.slice(0, 20) + '...');
}

main();
