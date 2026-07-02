const axios = require('axios');

const FAKE_IP = '223.5.5.5';
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Real-IP': FAKE_IP,
  'X-Forwarded-For': FAKE_IP,
};

function parseSetCookies(setCookies) {
  const jar = {};
  for (const c of (setCookies || [])) {
    const eq = c.indexOf('=');
    if (eq > 0) {
      const k = c.slice(0, eq).trim();
      const v = c.slice(eq + 1).split(';')[0];
      if (k) jar[k] = v;
    }
  }
  return jar;
}

function cookieJarToString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function hash33(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h += (h << 5) + s.charCodeAt(i);
  }
  return 2147483647 & h;
}

async function testQQLogin() {
  console.log('=== Step 1: 获取二维码 ===');
  const showUrl = 'https://ssl.ptlogin2.qq.com/ptqrshow';
  const showResp = await axios.get(showUrl, {
    params: {
      appid: '716027609',
      e: '2',
      l: 'M',
      s: '3',
      d: '72',
      v: '4',
      t: String(Math.random()),
      daid: '383',
      pt_3rd_aid: '100497308',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://y.qq.com/',
    },
    timeout: 15000,
    responseType: 'arraybuffer',
    maxRedirects: 0,
    validateStatus: () => true,
  });
  
  const jar = parseSetCookies(showResp.headers?.['set-cookie']);
  console.log('初始Cookies:', Object.keys(jar));
  const qrsig = jar.qrsig;
  console.log('qrsig:', qrsig ? '获取成功' : '获取失败');
  
  if (!qrsig) {
    console.log('Set-Cookie headers:', showResp.headers?.['set-cookie']);
    return;
  }
  
  console.log('\n=== Step 2: 轮询状态（请在30秒内扫码）===');
  console.log('二维码已生成，请扫描测试...');
  
  let attempts = 0;
  const poll = async () => {
    attempts++;
    const ptqrtoken = hash33(qrsig);
    
    // 尝试不同的u1参数 - QQ音乐官方登录使用的u1
    const u1 = 'https://y.qq.com/portal/wx_redirect.html';
    
    const loginUrl = 'https://ssl.ptlogin2.qq.com/ptqrlogin';
    console.log(`轮询尝试 ${attempts}...`);
    
    try {
      const resp = await axios.get(loginUrl, {
        params: {
          u1,
          ptqrtoken,
          ptredirect: '0',
          h: '1',
          t: '1',
          g: '1',
          from_ui: '1',
          ptlang: '2052',
          action: '0-0-' + Date.now(),
          js_ver: '24042410',
          js_type: '1',
          login_sig: jar.pt_login_sig || '',
          pt_uistyle: '40',
          aid: '716027609',
          daid: '383',
          pt_3rd_aid: '100497308',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: cookieJarToString(jar),
          Referer: 'https://y.qq.com/',
        },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
      
      Object.assign(jar, parseSetCookies(resp.headers?.['set-cookie']));
      console.log('响应状态:', resp.status);
      console.log('响应体:', resp.data);
      
      const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      const m = body.match(/ptuiCB\('(\d+)','(\d+)','([^']*)','(\d+)','([^']*)'/);
      
      if (m) {
        const [, code, , redirectUrl, , msg] = m;
        console.log('解析结果 - code:', code, 'msg:', msg);
        console.log('重定向URL:', redirectUrl);
        
        if (code === '0') {
          console.log('\n=== Step 3: 跟随重定向链 ===');
          let currentUrl = redirectUrl;
          for (let hop = 0; hop < 15; hop++) {
            console.log(`Hop ${hop}: ${currentUrl}`);
            try {
              const hopResp = await axios.get(currentUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  Cookie: cookieJarToString(jar),
                  Referer: 'https://y.qq.com/',
                },
                timeout: 15000,
                maxRedirects: 0,
                validateStatus: () => true,
              });
              Object.assign(jar, parseSetCookies(hopResp.headers?.['set-cookie']));
              console.log(`  Status: ${hopResp.status}`);
              console.log(`  Set-Cookie keys: ${Object.keys(parseSetCookies(hopResp.headers?.['set-cookie']))}`);
              
              let loc = hopResp.headers?.location;
              if (loc) {
                if (loc.startsWith('/')) {
                  try {
                    const u = new URL(currentUrl);
                    loc = `${u.protocol}//${u.host}${loc}`;
                  } catch (e) {}
                }
                console.log(`  Location: ${loc}`);
                if (loc.startsWith('http')) {
                  currentUrl = loc;
                  continue;
                }
              }
              
              // 如果是HTML响应，检查是否有script跳转或meta refresh
              if (hopResp.data && typeof hopResp.data === 'string') {
                const scriptMatch = hopResp.data.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
                const metaMatch = hopResp.data.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i);
                if (scriptMatch) {
                  console.log(`  Found script redirect: ${scriptMatch[1]}`);
                  let nextUrl = scriptMatch[1];
                  if (nextUrl.startsWith('/')) {
                    try {
                      const u = new URL(currentUrl);
                      nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
                    } catch (e) {}
                  }
                  currentUrl = nextUrl;
                  continue;
                }
                if (metaMatch) {
                  console.log(`  Found meta redirect: ${metaMatch[1]}`);
                  let nextUrl = metaMatch[1];
                  if (nextUrl.startsWith('/')) {
                    try {
                      const u = new URL(currentUrl);
                      nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
                    } catch (e) {}
                  }
                  currentUrl = nextUrl;
                  continue;
                }
              }
              
              break;
            } catch (e) {
              console.log(`  Hop error: ${e.message}`);
              break;
            }
          }
          
          console.log('\n=== Step 4: 访问QQ音乐主页获取完整Cookie ===');
          try {
            const homeResp = await axios.get('https://y.qq.com/', {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Cookie: cookieJarToString(jar),
              },
              timeout: 15000,
              maxRedirects: 5,
              validateStatus: () => true,
            });
            Object.assign(jar, parseSetCookies(homeResp.headers?.['set-cookie']));
            console.log('主页Cookies keys:', Object.keys(jar));
          } catch (e) {
            console.log('主页访问失败:', e.message);
          }
          
          console.log('\n=== 最终Cookie状态 ===');
          let uin = (jar.uin || jar.wxuin || '').toString();
          uin = uin.replace(/^o0*/, '');
          let key = jar.qqmusic_key || jar.ptmqmusicticket || jar.p_skey || jar.skey || '';
          for (const k of Object.keys(jar)) {
            if (/music.*key/i.test(k) && jar[k]) { key = jar[k]; break; }
          }
          console.log('uin:', uin || '未找到');
          console.log('qqmusic_key:', key ? '已获取' : '未获取');
          console.log('所有Cookie keys:', Object.keys(jar));
          return true;
        } else if (code === '66') {
          console.log('等待扫码...');
          return false;
        } else if (code === '67') {
          console.log('已扫码，等待确认...');
          return false;
        } else {
          console.log('其他状态，继续等待...');
          return false;
        }
      }
      return false;
    } catch (e) {
      console.log('轮询错误:', e.message);
      return false;
    }
  };
  
  // 轮询30次，每次2秒
  for (let i = 0; i < 30; i++) {
    const done = await poll();
    if (done) break;
    await new Promise(r => setTimeout(r, 2000));
  }
}

testQQLogin().catch(console.error);
