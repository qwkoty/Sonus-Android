import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, LogIn, RefreshCw, Cloud } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { CookieReader } from '../plugins/CookieReader';
import { music } from '../api/music';
import { netease } from '../api/netease';

export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();
  const {
    setNeteaseAuth, neteaseLoggedIn, neteaseUserInfo, neteaseCookie, neteaseUid, neteaseNickname,
    fetchNeteaseUserInfo, neteaseLogout,
  } = useAuthStore();

  // ===== QQ 音乐登录状态 =====
  const [view, setView] = useState(isLoggedIn ? 'account' : 'webview');
  const [webviewPhase, setWebviewPhase] = useState('idle');
  const [webviewTip, setWebviewTip] = useState('');
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // ===== 网易云二维码登录状态 =====
  // ncmPhase: idle | loading | showing | polling | success | error | expired
  const [ncmPhase, setNcmPhase] = useState('idle');
  const [ncmQrUrl, setNcmQrUrl] = useState('');
  const [ncmTip, setNcmTip] = useState('');
  const [ncmPlaylists, setNcmPlaylists] = useState(null);
  const [loadingNcmPlaylists, setLoadingNcmPlaylists] = useState(false);
  const ncmKeyRef = useRef('');
  const ncmPollTimerRef = useRef(null);

  // ===== QQ 音乐登录流程（原有逻辑，保持不变） =====
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
      setWebviewTip('登录成功，正在同步账号信息…');
      let cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      for (let i = 0; i < 3 && (!cookies.qqmusic_key); i++) {
        await new Promise(r => setTimeout(r, 800));
        cookies = await CookieReader.getCookiesForUrl('https://y.qq.com');
      }
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

  // ===== 网易云二维码登录流程 =====
  const stopNcmPolling = useCallback(() => {
    if (ncmPollTimerRef.current) {
      clearInterval(ncmPollTimerRef.current);
      ncmPollTimerRef.current = null;
    }
  }, []);

  const pollNcmQr = useCallback((key) => {
    stopNcmPolling();
    ncmPollTimerRef.current = setInterval(async () => {
      try {
        const r = await netease.qrCheck(key);
        const code = Number(r?.code);
        if (code === 801) {
          setNcmTip('等待扫码…');
        } else if (code === 802) {
          setNcmTip('已扫描，请在手机上确认登录');
        } else if (code === 803) {
          stopNcmPolling();
          // cookie 为空说明 Set-Cookie 捕获失败，提示错误而非误标记登录成功
          if (!r.cookie) {
            setNcmPhase('error');
            setNcmTip('登录态获取失败（cookie 为空），请重试');
            return;
          }
          setNcmTip('登录成功，正在同步账号…');
          // 登录成功：先用 cookie 拉取账号信息，再写入 store
          try {
            const info = await netease.accountInfo(r.cookie);
            setNeteaseAuth({
              cookie: r.cookie,
              uid: info?.uid || '',
              nickname: info?.nickname || '网易云用户',
            });
          } catch (e) {
            // 拉取用户信息失败也允许登录，后续可重试
            setNeteaseAuth({ cookie: r.cookie, uid: '', nickname: '网易云用户' });
          }
          setNcmPhase('success');
          setNcmQrUrl('');
          setNcmTip('');
        } else if (code === 800) {
          stopNcmPolling();
          setNcmPhase('expired');
          setNcmTip('二维码已过期，请重新生成');
        }
      } catch (e) {
        // 单次轮询失败不中断，等下一轮
        console.warn('[ncm poll] failed', e?.message || e);
      }
    }, 2000);
  }, [setNeteaseAuth, stopNcmPolling]);

  const startNcmQrLogin = useCallback(async () => {
    stopNcmPolling();
    setNcmPhase('loading');
    setNcmTip('正在生成二维码…');
    setNcmQrUrl('');
    try {
      const key = await netease.qrKey();
      ncmKeyRef.current = key;
      const loginUrl = `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
      const dataUrl = await QRCode.toDataURL(loginUrl, { margin: 1, width: 320 });
      setNcmQrUrl(dataUrl);
      setNcmPhase('showing');
      setNcmTip('请使用网易云音乐 App 扫码登录');
      // 开始轮询
      pollNcmQr(key);
    } catch (e) {
      setNcmPhase('error');
      setNcmTip('生成二维码失败：' + (e?.message || ''));
    }
  }, [pollNcmQr, stopNcmPolling]);

  const handleLoadNcmPlaylists = async () => {
    if (ncmPlaylists) return;
    if (!neteaseUid || !neteaseCookie) return;
    setLoadingNcmPlaylists(true);
    try {
      const list = await netease.userPlaylists(neteaseUid, neteaseCookie);
      setNcmPlaylists(list || []);
    } catch (e) {
      setNcmPlaylists([]);
    } finally {
      setLoadingNcmPlaylists(false);
    }
  };

  const handleNcmLogout = () => {
    stopNcmPolling();
    neteaseLogout();
    setNcmPhase('idle');
    setNcmQrUrl('');
    setNcmTip('');
    setNcmPlaylists(null);
  };

  // 卸载时清理定时器
  useEffect(() => {
    return () => stopNcmPolling();
  }, [stopNcmPolling]);

  // 网易云登录后自动拉取用户信息
  useEffect(() => {
    if (neteaseLoggedIn) {
      fetchNeteaseUserInfo();
      setNcmPhase('success');
    }
  }, [neteaseLoggedIn, fetchNeteaseUserInfo]);

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
        {/* QQ 音乐卡片（原有逻辑） */}
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

        {/* 网易云音乐卡片 */}
        <NeteaseCard
          loggedIn={neteaseLoggedIn}
          userInfo={neteaseUserInfo}
          nickname={neteaseNickname}
          uid={neteaseUid}
          playlists={ncmPlaylists}
          loadingPlaylists={loadingNcmPlaylists}
          phase={ncmPhase}
          qrUrl={ncmQrUrl}
          tip={ncmTip}
          onStartLogin={startNcmQrLogin}
          onLoadPlaylists={handleLoadNcmPlaylists}
          onLogout={handleNcmLogout}
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

// ===== 网易云音乐卡片 =====
function NeteaseCard({ loggedIn, userInfo, nickname, uid, playlists, loadingPlaylists, phase, qrUrl, tip, onStartLogin, onLoadPlaylists, onLogout }) {
  return (
    <div className="glass-panel-strong" style={{ position: 'relative', padding: 22, borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, alignSelf: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, #e60026, #ff4d6d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Cloud size={18} color="#fff" />
        </div>
        <span style={{ fontSize: 15, fontWeight: 760, color: 'var(--text-primary)' }}>网易云音乐</span>
      </div>

      {loggedIn ? (
        <NeteaseAccountView userInfo={userInfo} nickname={nickname} uid={uid} playlists={playlists} loadingPlaylists={loadingPlaylists} onLoadPlaylists={onLoadPlaylists} onLogout={onLogout} />
      ) : (
        <NeteaseQrLoginView phase={phase} qrUrl={qrUrl} tip={tip} onStartLogin={onStartLogin} />
      )}
    </div>
  );
}

function NeteaseAccountView({ userInfo, nickname, uid, playlists, loadingPlaylists, onLoadPlaylists, onLogout }) {
  const avatar = userInfo?.avatar || '';
  return (
    <>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 12, border: '2px solid rgba(230, 0, 38, .35)', boxShadow: '0 0 0 1px rgba(230, 0, 38, .10), 0 12px 36px rgba(0,0,0,0.32)' }}>
        {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={32} color="var(--text-secondary)" />}
      </div>

      <div style={{ fontSize: 18, fontWeight: 760, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        {nickname}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, letterSpacing: '.3px' }}>
        {uid ? `网易云账号 · ${uid}` : '网易云账号'}
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

function NeteaseQrLoginView({ phase, qrUrl, tip, onStartLogin }) {
  const isPolling = phase === 'showing' || phase === 'loading';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}>
      <div style={{ width: 60, height: 60, borderRadius: 18, background: 'linear-gradient(135deg, #e60026, #ff4d6d)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 34px rgba(230, 0, 38, 0.32)' }}>
        <Cloud size={26} color="#fff" />
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>登录 网易云音乐</div>

      {/* 二维码展示区 */}
      {qrUrl ? (
        <div style={{ position: 'relative', padding: 10, background: '#fff', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.32)' }}>
          <img src={qrUrl} alt="网易云登录二维码" style={{ display: 'block', width: 200, height: 200, borderRadius: 8 }} />
          {phase === 'expired' && (
            <div style={{ position: 'absolute', inset: 10, borderRadius: 8, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <RefreshCw size={22} color="#fff" />
              <span style={{ color: '#fff', fontSize: 12 }}>二维码已失效</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ width: 220, height: 220, borderRadius: 14, background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.12)' }}>
          {phase === 'loading' ? <Loader2 size={28} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /> : <Cloud size={42} color="var(--text-muted)" style={{ opacity: 0.5 }} />}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
        {phase === 'showing' || phase === 'loading'
          ? '使用网易云音乐 App 扫码登录'
          : phase === 'expired'
            ? '二维码已过期，点击下方按钮重新生成'
            : '点击下方按钮生成登录二维码'}
      </div>

      <button
        onClick={onStartLogin}
        disabled={isPolling}
        className="glass-button-accent"
        style={{ width: '100%', padding: '13px 20px', borderRadius: 14, fontSize: 14, fontWeight: 700, color: '#050608', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: isPolling ? 0.6 : 1 }}
      >
        {phase === 'loading'
          ? <><Loader2 size={18} className="spin-icon" /> 生成中…</>
          : phase === 'showing'
            ? <><Loader2 size={18} className="spin-icon" /> 等待扫码…</>
            : <><RefreshCw size={16} /> {phase === 'expired' ? '重新生成二维码' : '生成登录二维码'}</>}
      </button>

      {tip && (
        <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', color: phase === 'success' ? '#7ee2a8' : phase === 'error' || phase === 'expired' ? '#ff9fa6' : 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5 }}>{tip}</div>
      )}
    </div>
  );
}
