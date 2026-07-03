// QQ 扫码登录前端 JSONP 检查
//
// 为什么用前端 JSONP：
//   ptqrlogin 接口对服务器 IP 有风控（返回 403 空响应），
//   用 <script> 标签从用户浏览器直接请求，绕过服务器 IP 限制。
//   QQ 返回 ptuiCB('code','0','redirectUrl','0','msg','nick') 格式，
//   浏览器会自动执行这个回调。
//
// 关键参数 login_sig：
//   必须从后端 /login/qq/qrcode 返回的 login_sig 传入（来自 xlogin 的 pt_login_sig），
//   否则 ptqrlogin 无法正确返回登录状态。

function hash33(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash += (hash << 5) + s.charCodeAt(i);
  }
  return hash & 0x7FFFFFFF;
}

// 一次性检查扫码状态
// code: 66 等待扫码 / 67 已扫码待确认 / 0 成功 / 65 失效 / -1 网络/超时错误
// qrsig: 从 /login/qq/qrcode 获取
// loginSig: 从 /login/qq/qrcode 获取（来自 xlogin 的 pt_login_sig）
export function qqQrCheckJsonp(qrsig, loginSig = '') {
  return new Promise((resolve) => {
    const ptqrtoken = hash33(qrsig);
    let done = false;

    const cleanup = () => {
      if (window.ptuiCB === currentCb) delete window.ptuiCB;
      if (script && script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };

    const finish = (data) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };

    // ptuiCB('code','0','redirectUrl','0','msg','nickname')
    const currentCb = (code, _status, redirectUrl, _zero, msg, nickname) => {
      // redirectUrl 可能需要 URL 解码
      let url = redirectUrl || '';
      if (url && url.indexOf('%') !== -1) {
        try { url = decodeURIComponent(url); } catch {}
      }
      finish({ code: Number(code), redirectUrl: url, msg, nickname });
    };
    window.ptuiCB = currentCb;

    const params = new URLSearchParams({
      u1: 'https://y.qq.com/',
      ptqrtoken: String(ptqrtoken),
      ptredirect: '0',
      h: '1',
      t: '1',
      g: '1',
      from_ui: '1',
      ptlang: '2052',
      action: '0-0-' + Date.now(),
      js_ver: '24042410',
      js_type: '1',
      login_sig: loginSig || '',
      pt_uistyle: '40',
      aid: '716027609',
      daid: '383',
      pt_3rd_aid: '0',
    });

    const script = document.createElement('script');
    script.src = `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`;
    script.onerror = () => finish({ code: -1, msg: '扫码状态检测失败（QQ 接口暂不可用）' });
    document.head.appendChild(script);

    // 15s 超时
    const timer = setTimeout(() => finish({ code: -1, msg: '扫码状态检测超时' }), 15000);
  });
}

// 自动轮询扫码状态
//
// 用法：
//   const stop = qqQrPoll(qrsig, loginSig, {
//     onWaiting: () => {},      // code 66 等待扫码
//     onScanned: () => {},      // code 67 已扫码待确认
//     onSuccess: (redirectUrl, nickname) => {},  // code 0 成功
//     onExpired: () => {},      // code 65 二维码过期
//     onError: (msg) => {},     // code -1 网络/超时
//   });
//   // 需要停止时调用 stop()
export function qqQrPoll(qrsig, loginSig, callbacks) {
  const { onWaiting, onScanned, onSuccess, onExpired, onError } = callbacks;
  let stopped = false;
  let errorStreak = 0;
  let timer = null;

  const sleep = (ms) => new Promise((r) => {
    timer = setTimeout(r, ms);
    return () => clearTimeout(timer);
  });

  const pollOnce = async () => {
    if (stopped) return;
    const res = await qqQrCheckJsonp(qrsig, loginSig);
    if (stopped) return;

    switch (res.code) {
      case 0:
        if (res.redirectUrl) {
          onSuccess && onSuccess(res.redirectUrl, res.nickname);
          return;
        }
        onError && onError('登录信息异常，请刷新重试');
        return;
      case 66:
        errorStreak = 0;
        onWaiting && onWaiting();
        break;
      case 67:
        errorStreak = 0;
        onScanned && onScanned();
        break;
      case 65:
        onExpired && onExpired();
        return;
      default:
        errorStreak++;
        if (errorStreak >= 6) {
          onError && onError(res.msg || '扫码状态检测持续失败');
          return;
        }
        onError && onError(res.msg || '扫码状态检测重试中…');
        break;
    }

    if (!stopped) {
      const delay = 1800 + Math.random() * 700;
      await sleep(delay);
      if (!stopped) pollOnce();
    }
  };

  pollOnce();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
