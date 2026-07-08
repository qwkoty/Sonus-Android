import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Music, ArrowLeft, User, ListMusic, LogOut } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { getActiveSource } from '../sources/registry';
import { music } from '../api/music';
import QrLoginView from '../components/QrLoginView';

export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();
  const src = getActiveSource();

  const [view, setView] = useState(isLoggedIn ? 'account' : 'qr');
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

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
    setView('qr');
    setPlaylists(null);
  };

  useEffect(() => {
    if (isLoggedIn) { fetchUserInfo(); setView('account'); }
  }, [isLoggedIn, fetchUserInfo]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      background: 'radial-gradient(ellipse at 50% 28%, rgba(0, 245, 212, .10) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.82) 100%)',
      padding: 20, overflow: 'auto',
    }}>
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
        <AccountView userInfo={userInfo} nickname={nickname} uin={uin} playlists={playlists} loadingPlaylists={loadingPlaylists} onLoadPlaylists={handleLoadPlaylists} onLogout={handleLogout} isNetease={src.id === 'netease'} />
      ) : (
        <QrLoginView sourceId={src.id} onConfirmed={(creds) => setAuth(src.id, creds)} />
      )}
    </div>
  );
}

function AccountView({ userInfo, nickname, uin, playlists, loadingPlaylists, onLoadPlaylists, onLogout, isNetease }) {
  const rawAvatar = userInfo?.avatar;
  const fallbackAvatar = isNetease
    ? (userInfo?.avatar || '')
    : (uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '');
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
          : (isNetease ? '网易云音乐账号' : 'QQ音乐账号')}
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
