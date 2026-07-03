import { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, AlertCircle, LogIn } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrCheckJsonp } from '../utils/qqLogin';
import { isAndroid, getLoginMode } from '../utils/platform';
import { CookieReader } from '../plugins/CookieReader';

// 双模式登录：
// - Capacitor Android: 点击登录 → 打开 WebView 加载 y.qq.com → 自动检测 Cookie → 登录完成
// - 浏览器: ptlogin2 扫码 + "我已扫码登录"按钮（fallback）
export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();

  const loginMode = getLoginMode();
  const [view, setView] = useState(isLoggedIn ? 'account' : loginMode === 'webview' ? 'webview' : 'qr');

  // ===== WebView 模式状态 =====
  const [webviewPhase, setWebviewPhase] = useState('idle'); // idle | opening | polling | success | error
  const [webviewTip, setWebviewTip] = useState('');
  const pollTimerRef = useRef(null);

  // ===== QR 扫码模式状态 =====
  const [qrcode, setQrcode] = useState('');
  const [phase, setPhase] = useState('loading');
  const [tip, setTip] = useState('正在加载二维码…');
  const [errorMsg, setErrorMsg] = useState('');
  const qrsigRef = useRef('');
  const loginSigRef = useRef('');

  // ===== 账号页状态 =====
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // ===== WebView 登录逻辑 =====
  const startWebViewLogin = useCallback(async () => {
    setWebviewPhase('opening');
    setWebviewTip('正在打开 QQ 音乐登录页面…');

    // 监听 WebView 关闭事件
    const onClose = async (e) => {
      const detail = e?.detail || {};
      window.removeEventListener('qq-login-webview-closed', onClose);
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }

      if (detail.loggedIn) {
        // WebView 返回了登录成功标志，读取 Cookie
        await extractCookieAndLogin();
      } else {
        // 用户关闭了 WebView，可能还没登录
        setWebviewPhase('idle');
        setWebviewTip('');
      }
    };
    window.addEventListener('qq-login-webview-closed', onClose);

    // 尝试打开 WebView
    try {
      // 先检查当前是否已经有有效 Cookie（可能之前登录过）
      const currentCookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      if (currentCookies.loggedIn) {
        // 已登录！直接提取
        await handleCookieLogin(currentCookies);
        return;
      }

      // 通过 MainActivity 的 AndroidBridge 打开登录 WebView
      const opened = await CookieReader.openLoginWebView();
      if (!opened) {
        // AndroidBridge 不可用，降级到手动轮询
        setWebviewPhase('polling');
        setWebviewTip('请在系统浏览器中登录 QQ 音乐，完成后点"检查登录状态"');
        return;
      }

      // WebView 打开成功，开始定时轮询 Cookie
      setWebviewPhase('polling');
      setWebviewTip('请在弹出的窗口中登录 QQ 音乐…');
      pollTimerRef.current = setInterval(async () => {
        const cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
        if (cookies.loggedIn) {
          if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
          await handleCookieLogin(cookies);
        }
      }, 1500);
    } catch (e) {
      setWebviewPhase('error');
      setWebviewTip('打开登录页面失败：' + (e.message || ''));
    }
  }, []);

  const extractCookieAndLogin = async () => {
    setWebviewPhase('polling');
    setWebviewTip('正在读取登录信息…');
    try {
      const cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      await handleCookieLogin(cookies);
    } catch (e) {
      setWebviewPhase('error');
      setWebviewTip('读取登录信息失败：' + (e.message || ''));
    }
  };

  const handleCookieLogin = async (cookies) => {
    if (!cookies.cookie || !cookies.uin) {
      setWebviewPhase('error');
      setWebviewTip('Cookie 信息不完整，请重试');
      return;
    }

    setWebviewTip('登录成功，正在同步账号…');
    try {
      // 传给后端验证并获取完整信息
      const loginRes = await music.loginByCookie(cookies.cookie);
      if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
        setAuth({
          cookie: loginRes.cookie,
          uin: loginRes.uin,
          key: loginRes.key || cookies.qqmusic_key,
          nickname: loginRes.nickname || 'QQ音乐用户',
        });
        setWebviewPhase('success');
        setView('account');
        return;
      }
      // 后端验证失败，但本地 Cookie 有效，直接用本地数据
      setAuth({
        cookie: cookies.cookie,
        uin: cookies.uin,
        key: cookies.qqmusic_key,
        nickname: 'QQ音乐用户',
      });
      setWebviewPhase('success');
      setView('account');
    } catch (e) {
      // 后端不可用（离线场景），用本地 Cookie
      setAuth({
        cookie: cookies.cookie,
        uin: cookies.uin,
        key: cookies.qqmusic_key,
        nickname: 'QQ音乐用户',
      });
      setWebviewPhase('success');
      setView('account');
    }
  };

  // ===== QR 扫码逻辑 =====
  const fetchQr = async () => {
    setPhase('loading');
    setTip('正在加载二维码…');
    setErrorMsg('');
    setQrcode('');
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      qrsigRef.current = data.qrsig;
      loginSigRef.current = data.login_sig || '';
      setQrcode(data.qrcode);
      setPhase('waiting');
      setTip('请用 QQ 扫描二维码，并在手机上确认登录');
    } catch (e) {
      setErrorMsg(e.message || '获取二维码失败');
      setPhase('error');
      setTip('二维码加载失败');
    }
  };

  const handleConfirmLogin = async () => {
    if (!qrsigRef.current) { setErrorMsg('请先等待二维码加载'); return; }
    setPhase('checking');
    setTip('正在检查登录状态…');
    setErrorMsg('');
    const res = await qqQrCheckJsonp(qrsigRef.current, loginSigRef.current);
    switch (res.code) {
      case 0:
        if (res.redirectUrl) {
          setTip('登录成功，正在获取账号信息…');
          try {
            const loginRes = await music.loginByRedirect(res.redirectUrl, qrsigRef.current);
            if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
              setAuth({ cookie: loginRes.cookie, uin: loginRes.uin, key: loginRes.key, nickname: res.nickname || loginRes.nickname || 'QQ音乐用户' });
              setView('account');
              return;
            }
            setErrorMsg(loginRes?.msg || '登录信息收集失败');
            setPhase('error');
            setTip('登录失败');
          } catch (e) {
            setErrorMsg('登录失败：' + (e.message || ''));
            setPhase('error');
            setTip('登录失败');
          }
        } else {
          setErrorMsg('登录信息异常');
          setPhase('error');
          setTip('登录失败');
        }
        break;
      case 66:
        setErrorMsg('还没有扫码');
        setPhase('waiting');
        setTip('请用 QQ 扫描二维码');
        break;
      case 67:
        setErrorMsg('请在手机上点"确认登录"后再点此按钮');
        setPhase('waiting');
        setTip('请在手机上确认登录');
        break;
      case 65:
        setErrorMsg('二维码已过期');
        setPhase('error');
        setTip('二维码已过期');
        break;
      default:
        setErrorMsg(res.msg || '检查失败');
        setPhase('waiting');
        setTip('请确认已扫码并确认登录');
        break;
    }
  };

  // ===== 歌单加载 =====
  const handleLoadPlaylists = async () => {
    if (playlists) return;
    setLoadingPlaylists(true);
    try {
      const list = await music.userPlaylists(cookie, uin);
      setPlaylists(list || []);
    } catch (e) { setPlaylists([]); } finally { setLoadingPlaylists(false); }
  };

  const handleLogout = () => {
    logout();
    // Android 环境下清除 WebView Cookie
    if (isAndroid()) {
      CookieReader.clearCookiesForUrl('https://y.qq.com').catch(() => {});
    }
    setView(loginMode === 'webview' ? 'webview' : 'qr');
    setPlaylists(null);
    if (loginMode === 'qr') setTimeout(fetchQr, 100);
  };

  useEffect(() => {
    if (view === 'qr' && !qrcode) fetchQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, []);

  const qrBusy = phase === 'loading' || phase === 'checking';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 100%)',
      padding: 20, overflow: 'auto',
    }}>
      {/* 浮动光斑 */}
      <div className="glass-orb glass-orb-1" style={{ top: '15%', left: '10%' }} />
      <div className="glass-orb glass-orb-2" style={{ top: '50%', right: '5%' }} />
      <div className="glass-orb glass-orb-3" style={{ bottom: '10%', left: '30%' }} />

      {/* 返回按钮 */}
      {onBack && (
        <button onClick={onBack} className="glass-button" style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 16,
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
        }} title="返回播放器">
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginTop: 50, marginBottom: 28, zIndex: 1,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          background: 'var(--accent-dynamic)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(79,195,247,0.3)',
        }}>
          <Music size={22} color="#0A0A0A" />
        </div>
        <span style={{
          fontSize: 26, fontWeight: 800, letterSpacing: 1,
          background: 'linear-gradient(135deg, #fff, var(--accent-dynamic))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Sonus
        </span>
      </div>

      {view === 'account' ? (
        /* ===== 账号页面 ===== */
        <AccountView
          userInfo={userInfo} nickname={nickname} uin={uin}
          playlists={playlists} loadingPlaylists={loadingPlaylists}
          onLoadPlaylists={handleLoadPlaylists} onLogout={handleLogout}
        />
      ) : loginMode === 'webview' ? (
        /* ===== WebView 登录模式 ===== */
        <WebViewLoginView
          phase={webviewPhase} tip={webviewTip}
          onStartLogin={startWebViewLogin}
          onCheckStatus={extractCookieAndLogin}
        />
      ) : (
        /* ===== QR 扫码模式 ===== */
        <QrScanView
          qrcode={qrcode} phase={phase} tip={tip} errorMsg={errorMsg}
          isBusy={qrBusy}
          onFetchQr={fetchQr} onConfirmLogin={handleConfirmLogin}
        />
      )}
    </div>
  );
}

// ===== 子组件：账号页面 =====
function AccountView({ userInfo, nickname, uin, playlists, loadingPlaylists, onLoadPlaylists, onLogout }) {
  return (
    <div className="glass-panel-strong" style={{
      position: 'relative', zIndex: 1,
      padding: 24, borderRadius: 24, width: '100%', maxWidth: 400,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      {/* 头像 */}
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginBottom: 14,
        border: '2px solid var(--glass-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        {userInfo?.avatar ? (
          <img src={userInfo.avatar} alt="头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <User size={36} color="var(--text-secondary)" />
        )}
      </div>

      {/* 昵称 + VIP */}
      <div style={{
        fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
        marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {nickname}
        {userInfo?.vipLevel > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
            background: 'linear-gradient(135deg, #FFD700, #FFA500)', color: '#1a1a2e',
          }}>
            VIP{userInfo.vipLevel}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
        QQ: {uin}
      </div>

      {/* 歌单按钮 */}
      <button onClick={onLoadPlaylists} disabled={loadingPlaylists} className="glass-button-accent" style={{
        width: '100%', padding: '12px 16px', borderRadius: 12,
        fontSize: 14, fontWeight: 700, color: '#0A0A0A',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: loadingPlaylists ? 0.6 : 1,
      }}>
        {loadingPlaylists ? <><Loader2 size={16} className="spin-icon" /> 加载中…</> : <><ListMusic size={16} /> 查看我的歌单</>}
      </button>

      {/* 歌单列表 */}
      {playlists && playlists.length > 0 && (
        <div style={{ width: '100%', marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, paddingLeft: 4 }}>
            我的歌单 ({playlists.length})
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {playlists.map((pl) => (
              <div key={pl.id} className="glass-row" style={{ padding: '10px 12px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                {pl.cover ? (
                  <img src={pl.cover} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ListMusic size={16} color="var(--text-muted)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pl.songCount || 0} 首</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {playlists && playlists.length === 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>暂无歌单</div>
      )}

      <button onClick={onLogout} className="glass-button" style={{
        marginTop: 20, width: '100%', padding: '10px 16px', borderRadius: 12,
        fontSize: 13, fontWeight: 600, color: '#F87171',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <LogOut size={14} /> 退出登录
      </button>
    </div>
  );
}

// ===== 子组件：WebView 登录 =====
function WebViewLoginView({ phase, tip, onStartLogin, onCheckStatus }) {
  return (
    <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {/* 登录入口卡片 */}
      <div className="glass-panel-strong" style={{
        padding: 32, borderRadius: 24, width: '100%', maxWidth: 360,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: 'linear-gradient(135deg, #4FC3F7, #29B6F6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 30px rgba(79,195,247,0.4)',
        }}>
          <LogIn size={28} color="#0A0A0A" />
        </div>

        <div style={{
          fontSize: 18, fontWeight: 800, color: 'var(--text-primary)',
          textAlign: 'center',
        }}>
          登录 QQ 音乐
        </div>

        <div style={{
          fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6,
        }}>
          打开 QQ 音乐官方页面，扫码或输入密码登录<br />
          登录后自动同步，无需手动操作
        </div>

        <button
          onClick={onStartLogin}
          disabled={phase === 'opening' || phase === 'polling'}
          className="glass-button-accent"
          style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            fontSize: 15, fontWeight: 700, color: '#0A0A0A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: (phase === 'opening' || phase === 'polling') ? 0.6 : 1,
            boxShadow: '0 8px 30px rgba(79,195,247,0.35)',
          }}
        >
          {phase === 'opening' ? (
            <><Loader2 size={18} className="spin-icon" /> 正在打开…</>
          ) : phase === 'polling' ? (
            <><Loader2 size={18} className="spin-icon" /> 等待登录…</>
          ) : (
            <><LogIn size={18} /> 打开 QQ 音乐登录</>
          )}
        </button>

        {/* 手动检查按钮（WebView 不可用时） */}
        {phase === 'polling' && (
          <button onClick={onCheckStatus} className="glass-button" style={{
            padding: '10px 16px', borderRadius: 10,
            fontSize: 13, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <CheckCircle2 size={14} /> 检查登录状态
          </button>
        )}
      </div>

      {/* 状态提示 */}
      {tip && (
        <div style={{
          fontSize: 13, fontWeight: 600, textAlign: 'center',
          color: phase === 'success' ? '#4ADE80' : phase === 'error' ? '#F87171' : 'var(--text-secondary)',
          maxWidth: 300, lineHeight: 1.5,
        }}>
          {tip}
        </div>
      )}

      {/* 底部说明 */}
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6,
      }}>
        支持 QQ 扫码 / QQ号密码 / 微信扫码<br />
        登录后即可听 VIP 歌曲 + 同步歌单
      </div>
    </div>
  );
}

// ===== 子组件：QR 扫码模式 =====
function QrScanView({ qrcode, phase, tip, errorMsg, isBusy, onFetchQr, onConfirmLogin }) {
  return (
    <>
      {/* 二维码卡片 */}
      <div className="glass-panel-strong" style={{
        position: 'relative', zIndex: 1, padding: 18, borderRadius: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {phase === 'loading' ? (
          <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
          </div>
        ) : qrcode ? (
          <div style={{ position: 'relative' }}>
            <img src={qrcode} alt="登录二维码" style={{
              width: 200, height: 200, borderRadius: 16, imageRendering: 'pixelated',
              background: '#fff', padding: 10, display: 'block',
              filter: phase === 'checking' ? 'blur(4px) opacity(0.5)' : 'none',
              transition: 'filter 0.3s ease',
            }} />
            {phase === 'checking' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{
            width: 200, height: 200, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
            fontSize: 13, textAlign: 'center', padding: 20, gap: 12,
          }}>
            <AlertCircle size={28} color="#F87171" />
            <span>{errorMsg || '二维码加载失败'}</span>
            <button onClick={onFetchQr} className="glass-button" style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        )}
      </div>

      {/* 状态文案 */}
      <div style={{
        marginTop: 20, fontSize: 15, fontWeight: 600, textAlign: 'center',
        color: phase === 'checking' ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
        zIndex: 1, transition: 'color 0.3s ease', minHeight: 22,
      }}>
        {tip}
      </div>

      {errorMsg && phase !== 'checking' && (
        <div style={{
          marginTop: 8, fontSize: 12, color: '#FBBF24', textAlign: 'center', zIndex: 1,
          maxWidth: 300, lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0 }} /> {errorMsg}
        </div>
      )}

      {/* 我已扫码登录按钮 */}
      {qrcode && phase !== 'loading' && (
        <button onClick={onConfirmLogin} disabled={isBusy} className="glass-button-accent" style={{
          marginTop: 18, padding: '14px 32px', borderRadius: 14,
          fontSize: 15, fontWeight: 700, color: '#0A0A0A',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: isBusy ? 0.6 : 1, zIndex: 1,
          boxShadow: '0 8px 30px rgba(79,195,247,0.35)',
        }}>
          {phase === 'checking' ? <><Loader2 size={18} className="spin-icon" /> 正在检查…</> : <><CheckCircle2 size={18} /> 我已扫码登录</>}
        </button>
      )}

      {qrcode && !isBusy && (
        <button onClick={onFetchQr} className="glass-button" style={{
          marginTop: 12, padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6, zIndex: 1,
        }}>
          <RefreshCw size={13} /> 刷新二维码
        </button>
      )}

      <div className="glass-panel" style={{
        marginTop: 18, padding: '12px 16px', borderRadius: 12, zIndex: 1,
        maxWidth: 320, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--accent-dynamic)', marginBottom: 4 }}>操作步骤</div>
        <div>1. 用手机 QQ 扫描上方二维码</div>
        <div>2. 在手机 QQ 上点击"确认登录"</div>
        <div>3. 点击上方"我已扫码登录"按钮</div>
      </div>

      <div style={{ marginTop: 20, marginBottom: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', zIndex: 1 }}>
        仅用于解锁 VIP 音源与同步歌单 · 登录后即可听歌
      </div>
    </>
  );
}
