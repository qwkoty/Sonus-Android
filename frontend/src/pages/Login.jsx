import { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, AlertCircle, LogIn } from 'lucide-react';
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

  const startWebViewLogin = useCallback(async () => {
    setWebviewPhase('opening');
    setWebviewTip('正在打开 QQ 音乐登录页面…');

    try {
      const currentCookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      if (currentCookies.loggedIn) {
        await handleCookieLogin(currentCookies);
        return;
      }

      setWebviewPhase('polling');
      setWebviewTip('请在弹出的窗口中登录 QQ 音乐…');

      await CookieReader.openLoginWebView();
      setWebviewTip('登录成功，正在同步账号…');
      const cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      await handleCookieLogin(cookies);
    } catch (e) {
      setWebviewPhase('error');
      setWebviewTip('登录已取消：' + (e.message || ''));
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
      const loginRes = await music.loginByCookie(cookies.cookie);
      if (Number(loginRes?.code) === 0) {
        setAuth({
          cookie: loginRes.cookie || cookies.cookie,
          uin: loginRes.uin || cookies.uin,
          key: loginRes.key || cookies.qqmusic_key,
          nickname: loginRes.nickname || 'QQ音乐用户',
        });
      } else {
        setAuth({
          cookie: cookies.cookie,
          uin: cookies.uin,
          key: cookies.qqmusic_key,
          nickname: 'QQ音乐用户',
        });
      }
      setWebviewPhase('success');
      setView('account');
    } catch (e) {
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
      background: 'radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--accent-dynamic) 12%, transparent) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.7) 100%)',
      padding: 20, overflow: 'auto',
    }}>
      <div className="glass-orb glass-orb-1" style={{ top: '15%', left: '10%' }} />
      <div className="glass-orb glass-orb-2" style={{ top: '50%', right: '5%' }} />
      <div className="glass-orb glass-orb-3" style={{ bottom: '10%', left: '30%' }} />

      {onBack && (
        <button onClick={onBack} className="glass-button" style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 16,
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
        }} title="返回播放器">
          <ArrowLeft size={18} />
        </button>
      )}

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
        <AccountView
          userInfo={userInfo} nickname={nickname} uin={uin}
          playlists={playlists} loadingPlaylists={loadingPlaylists}
          onLoadPlaylists={handleLoadPlaylists} onLogout={handleLogout}
        />
      ) : (
        <WebViewLoginView
          phase={webviewPhase} tip={webviewTip}
          onStartLogin={startWebViewLogin}
          onCheckStatus={extractCookieAndLogin}
        />
      )}
    </div>
  );
}

function AccountView({ userInfo, nickname, uin, playlists, loadingPlaylists, onLoadPlaylists, onLogout }) {
  return (
    <div className="glass-panel-strong" style={{
      position: 'relative', zIndex: 1,
      padding: 24, borderRadius: 24, width: '100%', maxWidth: 400,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginBottom: 14,
        border: '2px solid var(--glass-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        {userInfo?.avatar ? (
          <img src={userInfo.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <User size={36} color="var(--text-secondary)" />
        )}
      </div>

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

      <button onClick={onLoadPlaylists} disabled={loadingPlaylists} className="glass-button-accent" style={{
        width: '100%', padding: '12px 16px', borderRadius: 12,
        fontSize: 14, fontWeight: 700, color: '#0A0A0A',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: loadingPlaylists ? 0.6 : 1,
      }}>
        {loadingPlaylists ? <><Loader2 size={16} className="spin-icon" /> 加载中…</> : <><ListMusic size={16} /> 查看我的歌单</>}
      </button>

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

function WebViewLoginView({ phase, tip, onStartLogin, onCheckStatus }) {
  return (
    <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
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

      {tip && (
        <div style={{
          fontSize: 13, fontWeight: 600, textAlign: 'center',
          color: phase === 'success' ? '#4ADE80' : phase === 'error' ? '#F87171' : 'var(--text-secondary)',
          maxWidth: 300, lineHeight: 1.5,
        }}>
          {tip}
        </div>
      )}

      <div style={{
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6,
      }}>
        支持 QQ 扫码 / QQ号密码 / 微信扫码<br />
        登录后即可听 VIP 歌曲 + 同步歌单
      </div>
    </div>
  );
}
