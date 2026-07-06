import { useState, useEffect, useCallback } from 'react';
import { Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, LogIn } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { CookieReader } from '../plugins/CookieReader';
import { music } from '../api/music';

export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();

  // QQ 音乐登录状态
  const [view, setView] = useState(isLoggedIn ? 'account' : 'webview');
  const [webviewPhase, setWebviewPhase] = useState('idle');
  const [webviewTip, setWebviewTip] = useState('');
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // QQ 音乐登录流程
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
      const wvRes = await CookieReader.openLoginWebView();
      setWebviewTip('登录成功，正在同步账号信息…');
      // WebView 已返回 cookie + 页面提取的昵称/头像
      const cookies = {
        cookie: wvRes?.cookie || '',
        uin: '',
        qqmusic_key: '',
        loggedIn: wvRes?.loggedIn || false,
      };
      // 从 cookie 字符串中解析 uin 和 key
      if (cookies.cookie) {
        const uinMatch = cookies.cookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
        if (uinMatch) cookies.uin = uinMatch[1];
        const keyMatch = cookies.cookie.match(/(?:^|;\s*)(qm_keyst|qqmusic_key|music_key)=([^;]+)/);
        if (keyMatch) cookies.qqmusic_key = keyMatch[2];
      }
      // 如果 WebView 没拿到昵称，再fallback读 CookieManager
      if (!wvRes?.nickname) {
        const cm = await CookieReader.getCookiesForUrl('https://y.qq.com');
        if (cm?.cookie) {
          cookies.cookie = cm.cookie;
          cookies.uin = cm.uin || cookies.uin;
          cookies.qqmusic_key = cm.qqmusic_key || cookies.qqmusic_key;
          cookies.loggedIn = cm.loggedIn;
        }
      }
      await handleCookieLogin(cookies, wvRes?.nickname, wvRes?.avatar);
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

  const handleCookieLogin = async (cookies, wvNickname, wvAvatar) => {
    if (!cookies.cookie || !cookies.uin) {
      setWebviewPhase('error');
      setWebviewTip('Cookie 信息不完整，请重试');
      return;
    }
    setWebviewTip('登录成功，正在同步账号…');
    // 优先使用 WebView 从页面提取的昵称/头像
    let nickname = wvNickname || '';
    let avatar = wvAvatar || '';
    try {
      const loginRes = await music.loginByCookie(cookies.cookie);
      if (Number(loginRes?.code) === 0) {
        nickname = nickname || loginRes.nickname;
        avatar = avatar || loginRes.avatar;
      }
    } catch (e) {}
    setAuth({
      cookie: cookies.cookie,
      uin: cookies.uin,
      key: cookies.qqmusic_key,
      nickname: nickname || 'QQ音乐用户',
      avatar: avatar || '',
    });
    setWebviewPhase('success');
    setView('account');
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

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* QQ 音乐卡片 */}
        <QQMusicCard
          view={view}
          userInfo={userInfo}
          nickname={nickname}
          uin={uin}
          playlists={playlists}
          loadingPlaylists={loadingPlaylists}
          webviewPhase={webviewPhase}
          webviewTip={webviewTip}
          onStartLogin={startWebViewLogin}
          onCheckStatus={extractCookieAndLogin}
          onLoadPlaylists={handleLoadPlaylists}
          onLogout={handleLogout}
        />
      </div>
    </div>
  );
}

// ===== QQ 音乐卡片 =====
function QQMusicCard({ view, userInfo, nickname, uin, playlists, loadingPlaylists, webviewPhase, webviewTip, onStartLogin, onCheckStatus, onLoadPlaylists, onLogout }) {
  return (
    <div className="glass-panel-strong" style={{ position: 'relative', padding: 22, borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, alignSelf: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, var(--accent-dynamic), #00c9a7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Music size={18} color="#050608" />
        </div>
        <span style={{ fontSize: 15, fontWeight: 760, color: 'var(--text-primary)' }}>QQ音乐</span>
      </div>

      {view === 'account' ? (
        <QQAccountView userInfo={userInfo} nickname={nickname} uin={uin} playlists={playlists} loadingPlaylists={loadingPlaylists} onLoadPlaylists={onLoadPlaylists} onLogout={onLogout} />
      ) : (
        <QQWebViewLoginView phase={webviewPhase} tip={webviewTip} onStartLogin={onStartLogin} onCheckStatus={onCheckStatus} />
      )}
    </div>
  );
}

function QQAccountView({ userInfo, nickname, uin, playlists, loadingPlaylists, onLoadPlaylists, onLogout }) {
  const rawAvatar = userInfo?.avatar;
  const fallbackAvatar = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';
  const avatar = rawAvatar || fallbackAvatar;
  return (
    <>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 12, border: '2px solid rgba(0, 245, 212, .35)', boxShadow: '0 0 0 1px rgba(0, 245, 212, .10), 0 12px 36px rgba(0,0,0,0.32)' }}>
        {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={32} color="var(--text-secondary)" />}
      </div>

      <div style={{ fontSize: 18, fontWeight: 760, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        {nickname}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, letterSpacing: '.3px' }}>
        {userInfo?.follow > 0 || userInfo?.fans > 0
          ? `关注 ${userInfo.follow || 0} · 粉丝 ${userInfo.fans || 0}`
          : 'QQ音乐账号'}
      </div>

      <button onClick={onLoadPlaylists} disabled={loadingPlaylists} className="glass-button-accent" style={{ width: '100%', padding: '12px 16px', borderRadius: 14, fontSize: 14, fontWeight: 700, color: '#050608', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loadingPlaylists ? 0.6 : 1 }}>
        {loadingPlaylists ? <><Loader2 size={16} className="spin-icon" /> 加载中…</> : <><ListMusic size={16} /> 查看我的歌单</>}
      </button>

      {playlists && playlists.length > 0 && (
        <div style={{ width: '100%', marginTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>我的歌单 ({playlists.length})</div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {playlists.map((pl) => (
              <div key={pl.id} className="glass-row" style={{ padding: '10px 12px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                {pl.cover ? <img src={pl.cover} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }} /> : <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ListMusic size={18} color="var(--text-muted)" /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pl.songCount || 0} 首</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {playlists && playlists.length === 0 && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>暂无歌单</div>}

      <button onClick={onLogout} className="glass-button" style={{ marginTop: 18, width: '100%', padding: '10px 16px', borderRadius: 14, fontSize: 13, fontWeight: 600, color: '#ff9fa6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <LogOut size={14} /> 退出登录
      </button>
    </>
  );
}

function QQWebViewLoginView({ phase, tip, onStartLogin, onCheckStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}>
      <div style={{ width: 60, height: 60, borderRadius: 18, background: 'linear-gradient(135deg, var(--accent-dynamic), #00c9a7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 34px rgba(0, 245, 212, 0.32)' }}>
        <LogIn size={26} color="#050608" />
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>登录 QQ 音乐</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>打开 QQ 音乐官方页面，扫码或输入密码登录<br />登录后自动同步，无需手动操作</div>

      <button onClick={onStartLogin} disabled={phase === 'opening' || phase === 'polling'} className="glass-button-accent" style={{ width: '100%', padding: '13px 20px', borderRadius: 14, fontSize: 14, fontWeight: 700, color: '#050608', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (phase === 'opening' || phase === 'polling') ? 0.6 : 1 }}>
        {phase === 'opening' ? <><Loader2 size={18} className="spin-icon" /> 正在打开…</> : phase === 'polling' ? <><Loader2 size={18} className="spin-icon" /> 等待登录…</> : <><LogIn size={18} /> 打开 QQ 音乐登录</>}
      </button>

      {phase === 'polling' && (
        <button onClick={onCheckStatus} className="glass-button" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={14} /> 检查登录状态
        </button>
      )}

      {tip && (
        <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', color: phase === 'success' ? '#7ee2a8' : phase === 'error' ? '#ff9fa6' : 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5 }}>{tip}</div>
      )}
    </div>
  );
}
