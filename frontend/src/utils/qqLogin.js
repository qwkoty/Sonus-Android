// QQ 扫码登录前端 JSONP 检查 + 自动轮询
//
// 为什么用前端 JSONP：
//   ptqrlogin 接口对服务器 IP 有风控（返回 403 空响应），
//   用 <script> 标签从用户浏览器直接请求，绕过服务器 IP 限制。
//   QQ 返回 ptuiCB('code','0','redirectUrl','0','msg','nick') 格式，
//   浏览器会自动执行这个回调。

function hash33(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash += (hash << 5) + s.charCodeAt(i);
  }
  return hash & 0x7FFFFFFF;
}

// 一次性检查扫码状态
// code: 66 等待扫码 / 67 已扫码待确认 / 0 成功 / 65 失效 / -1 网络/超时错误
export function qqQrCheckJsonp(qrsig) {
  return new Promise((resolve) => {
    const ptqrtoken = hash33(qrsig);
    let done = false;

    const cleanup = () => {
      if (window.ptuiCB === currentCb) delete window.ptuiCB;
      if (script.parentNode) script.parentNode.removeChild(script);
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
      finish({ code: Number(code), redirectUrl, msg, nickname });
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
      login_sig: '',
      pt_uistyle: '40',
      aid: '716027609',
      daid: '383',
      pt_3rd_aid: '0',
    });

    const script = document.createElement('script');
    script.src = `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`;
    // 触发场景：QQ 网关普遍 403（不是 CORS，不是浏览器拦截）
    script.onerror = () => finish({ code: -1, msg: '扫码状态检测失败（QQ 接口暂不可用）' });
    document.head.appendChild(script);

    // 15s 超时
    const timer = setTimeout(() => finish({ code: -1, msg: '扫码状态检测超时' }), 15000);
  });
}

// 自动轮询扫码状态
//
// 用法：
//   const stop = qqQrPoll(qrsig, {
//     onWaiting: () => {},      // code 66 等待扫码
//     onScanned: () => {},      // code 67 已扫码待确认
//     onSuccess: (redirectUrl, nickname) => {},  // code 0 成功
//     onExpired: () => {},      // code 65 二维码过期
//     onError: (msg) => {},     // code -1 网络/超时
//   });
//   // 需要停止时调用 stop()
//
// 轮询策略：
//   - 间隔 1.8~2.5s 随机抖动，避免被识别为机器人
//   - 连续 3 次网络错误后停止（避免无限重试）
//   - 成功/过期后自动停止
//   - 返回 stop() 函数供外部中断
export function qqQrPoll(qrsig, callbacks) {
  const { onWaiting, onScanned, onSuccess, onExpired, onError } = callbacks;
  let stopped = false;
  let errorStreak = 0;
  let timer = null;

  const sleep = (ms) => new Promise((r) => {
    timer = setTimeout(r, ms);
    // 让 timer 可被 stop 清除
    return () => clearTimeout(timer);
  });

  const pollOnce = async () => {
    if (stopped) return;
    const res = await qqQrCheckJsonp(qrsig);
    if (stopped) return;

    switch (res.code) {
      case 0:
        if (res.redirectUrl) {
          onSuccess && onSuccess(res.redirectUrl, res.nickname);
          return; // 成功，停止轮询
        }
        // redirectUrl 为空视为异常
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
        return; // 过期，停止
      default:
        // -1 或未知
        errorStreak++;
        // 风控场景下一直会 403，不要快速停止——给用户扫码留时间
        // 改为只要 phase 还停留足够时间就继续重试
        if (errorStreak >= 6) {
          onError && onError(res.msg || '扫码状态检测持续失败，请用 Cookie 模式登录');
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

  // 启动轮询
  pollOnce();

  // 返回停止函数
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
