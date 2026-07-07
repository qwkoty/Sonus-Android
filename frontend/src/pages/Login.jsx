import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, LogIn } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { CookieReader } from '../plugins/CookieReader';
import { music } from '../api/music';

export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();

  const [view, setView] = useState(isLoggedIn ? 'account' : 'webview');
  const [webviewPhase, setWebviewPhase] = useState('idle');
  const [webviewTip, setWebviewTip] = useState('');
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // 非阻塞轮询：登录 WebView 切后台后仍可持续检测
  const pollRef = useRef(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
        if (cookies.loggedIn && cookies.cookie && cookies.uin) {
          stopPolling();
          await handleCookieLogin(cookies);
        }
      } catch (e) {
        // 轮询中忽略单点错误
      }
    }, 1200);
  }, [stopPolling]);

  const startWebViewLogin = useCallback(async () => {
    setWebviewPhase('opening');
    setWebviewTip('正在打开 QQ 音乐登录页面…');
    try {
      const currentCookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      if (currentCookies.loggedIn) {
        await handleCookieLogin(currentCookies);
        return;
      }
      await CookieReader.openLoginWebView();
      setWebviewPhase('polling');
      setWebviewTip('请在弹出的窗口中登录 QQ 音乐（可切到 QQ/相机扫码）…');
      startPolling();
    } catch (e) {
      setWebviewPhase('error');
      setWebviewTip('打开登录窗口失败：' + (e.message || ''));
    }
  }, [startPolling]);

  const extractCookieAndLogin = async () => {
    setWebviewPhase('polling');
    setWebviewTip('正在读取登录信息…');
    try {
      const cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      if (cookies.loggedIn && cookies.cookie && cookies.uin) {
        stopPolling();
        await handleCookieLogin(cookies);
      } else {
        setWebviewTip('尚未检测到登录信息，请在 WebView 中完成登录');
      }
    } catch (e) {
      setWebviewPhase('error');
      setWebviewTip('读取登录信息失败：' + (e.message || ''));
    }
  };

  // 监听原生登录成功事件（切回 APP 时触发）
  useEffect(() => {
    const cleanup = CookieReader.onLoginSuccess(() => {
      stopPolling();
      extractCookieAndLogin();
    });
    return cleanup;
  }, [stopPolling, extractCookieAndLogin]);

  // 页面重新可见时自动检查一次（切回 APP）
  useEffect(() => {
    if (webviewPhase !== 'polling') return;
    const onVisible = () => {
      if (!document.hidden) extractCookieAndLogin();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [webviewPhase, extractCookieAndLogin]);

  // 组件卸载时停止轮询
  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleCookieLogin = async (cookies) => {
    if (!cookies.cookie || !cookies.uin) {
      setWebviewPhase('error');
      setWebviewTip('Cookie 信息不完整，请重试');
      return;
    }
    setWebviewTip('登录成功，正在同步账号…');
    try {
      const loginRes = await music.loginByCookie(cookies.cookie);
      if (Number(loginRes?.code) === 0) {
        setAuth({ cookie: loginRes.cookie || cookies.cookie, uin: loginRes.uin || cookies.uin, key: loginRes.key || cookies.qqmusic_key, nickname: loginRes.nickname || 'QQ音乐用户' });
      } else {
        setAuth({ cookie: cookies.cookie, uin: cookies.uin, key: cookies.qqmusic_key, nickname: 'QQ音乐用户' });
      }
      setWebviewPhase('success');
      setView('account');
    } catch (e) {
      setAuth({ cookie: cookies.cookie, uin: cookies.uin, key: cookies.qqmusic_key, nickname: 'QQ音乐用户' });
      setWebviewPhase('success');
      setView('account');
    }
  };

  const handleLoadPlaylists = async () => {
    if (playlists) return;
    setLoadingPlaylists(true);
    try {
      const list = await music.userPlaylists(cookie, uin);
      setPlaylists(list || []);
    } catch (e) {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const handleLogout = () => {
    logout();
    CookieReader.clearCookiesForUrl('https://y.qq.com').catch(() => {});
    setView('webview');
    setPlaylists(null);
    setWebviewPhase('idle');
    setWebviewTip('');
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      setView('account');
    }
  }, [isLoggedIn, fetchUserInfo]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      background: 'radial-gradient(ellipse at 50% 28%, rgba(0, 245, 212, .10) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.82) 100%)',
      padding: 20, overflow: 'auto',
    }}>
      {/* 玻璃球装饰 */}
      <div style={{ position: 'fixed', top: '15%', left: '8%', width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, rgba(0, 245, 212, .12), rgba(0, 245, 212, .03) 60%, transparent)', filter: 'blur(24px)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '55%', right: '5%', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, rgba(244,210,138,.10), rgba(244,210,138,.03) 60%, transparent)', filter: 'blur(30px)', pointerEvents: 'none' }} />

      {onBack && (
        <button onClick={onBack} className="glass-button" style={{ position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 16, width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }} title="返回播放器">
          <ArrowLeft size={18} />
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 54, marginBottom: 26, zIndex: 1 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--accent-dynamic)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0, 245, 212, 0.28)' }}>
          <Music size={24} color="#050608" />
        </div>
        <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1.2, background: 'linear-gradient(135deg, #fff, var(--accent-dynamic))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Sonus</span>
      </div>

      {view === 'account' ? (
        <AccountView userInfo={userInfo} nickname={nickname} uin={uin} playlists={playlists} loadingPlaylists={loadingPlaylists} onLoadPlaylists={handleLoadPlaylists} onLogout={handleLogout} />
      ) : (
        <WebViewLoginView phase={webviewPhase} tip={webviewTip} onStartLogin={startWebViewLogin} onCheckStatus={extractCookieAndLogin} />
      )}
    </div>
  );
}

function AccountView({ userInfo, nickname, uin, playlists, loadingPlaylists, onLoadPlaylists, onLogout }) {
  const rawAvatar = userInfo?.avatar;
  const fallbackAvatar = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';
  const avatar = rawAvatar || fallbackAvatar;
  return (
    <div className="glass-panel-strong" style={{ position: 'relative', zIndex: 1, padding: 26, borderRadius: 26, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14, border: '2px solid rgba(0, 245, 212, .35)', boxShadow: '0 0 0 1px rgba(0, 245, 212, .10), 0 12px 36px rgba(0,0,0,0.32)' }}>
        {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={38} color="var(--text-secondary)" />}
      </div>

      <div style={{ fontSize: 21, fontWeight: 760, color: 'var(--text-primary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {nickname}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 22, letterSpacing: '.3px' }}>
        {userInfo?.follow > 0 || userInfo?.fans > 0
          ? `关注 ${userInfo.follow || 0} · 粉丝 ${userInfo.fans || 0}`
          : 'QQ音乐账号'}
      </div>

      <button onClick={onLoadPlaylists} disabled={loadingPlaylists} className="glass-button-accent" style={{ width: '100%', padding: '13px 16px', borderRadius: 14, fontSize: 14, fontWeight: 700, color: '#050608', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loadingPlaylists ? 0.6 : 1 }}>
        {loadingPlaylists ? <><Loader2 size={16} className="spin-icon" /> 加载中…</> : <><ListMusic size={16} /> 查看我的歌单</>}
      </button>

      {playlists && playlists.length > 0 && (
        <div style={{ width: '100%', marginTop: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>我的歌单 ({playlists.length})</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {playlists.map((pl) => (
              <div key={pl.id} className="glass-row" style={{ padding: '10px 12px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                {pl.cover ? <img src={pl.cover} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: 'cover' }} /> : <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ListMusic size={18} color="var(--text-muted)" /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pl.songCount || 0} 首</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {playlists && playlists.length === 0 && <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>暂无歌单</div>}

      <button onClick={onLogout} className="glass-button" style={{ marginTop: 22, width: '100%', padding: '11px 16px', borderRadius: 14, fontSize: 13, fontWeight: 600, color: '#ff9fa6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <LogOut size={14} /> 退出登录
      </button>
    </div>
  );
}

function WebViewLoginView({ phase, tip, onStartLogin, onCheckStatus }) {
  return (
    <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div className="glass-panel-strong" style={{ padding: 32, borderRadius: 26, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 68, height: 68, borderRadius: 20, background: 'linear-gradient(135deg, var(--accent-dynamic), #00c9a7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 34px rgba(0, 245, 212, 0.32)' }}>
          <LogIn size={30} color="#050608" />
        </div>

        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>登录 QQ 音乐</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>打开 QQ 音乐官方页面，扫码或输入密码登录<br />登录后自动同步，无需手动操作</div>

        <button onClick={onStartLogin} disabled={phase === 'opening' || phase === 'polling'} className="glass-button-accent" style={{ width: '100%', padding: '14px 20px', borderRadius: 16, fontSize: 15, fontWeight: 700, color: '#050608', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (phase === 'opening' || phase === 'polling') ? 0.6 : 1 }}>
          {phase === 'opening' ? <><Loader2 size={18} className="spin-icon" /> 正在打开…</> : phase === 'polling' ? <><Loader2 size={18} className="spin-icon" /> 等待登录…</> : <><LogIn size={18} /> 打开 QQ 音乐登录</>}
        </button>

        {phase === 'polling' && (
          <button onClick={onCheckStatus} className="glass-button" style={{ padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} /> 检查登录状态
          </button>
        )}
      </div>

      {tip && (
        <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', color: phase === 'success' ? '#7ee2a8' : phase === 'error' ? '#ff9fa6' : 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5 }}>{tip}</div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>支持 QQ 扫码 / QQ号密码 / 微信扫码<br />登录后即可听 VIP 歌曲 + 同步歌单</div>
    </div>
  );
}
