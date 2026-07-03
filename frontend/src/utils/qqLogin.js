// QQ 扫码登录前端 JSONP 检查
// ptqrlogin 返回 ptuiCB('code','0','redirectUrl','0','msg','nick') 格式
// 用 <script> 标签请求，从用户浏览器直接发出，不经过服务器，不受服务器 IP 风控影响

function hash33(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash += (hash << 5) + s.charCodeAt(i);
  }
  return hash & 0x7FFFFFFF;
}

// 检查扫码状态，返回 { code, redirectUrl, msg, nickname }
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
    // QQ 返回的 ptuiCB 调用会被浏览器执行，触发 window.__ptuiCB
    script.src = `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`;
    script.onerror = () => finish({ code: -1, msg: '网络错误，请检查网络连接' });
    document.head.appendChild(script);

    const timer = setTimeout(() => finish({ code: -1, msg: '请求超时' }), 10000);
  });
}
