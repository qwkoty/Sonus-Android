import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, RefreshCw, QrCode } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { getActiveSource } from '../sources/registry';
import { music } from '../api/music';

export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();
  const src = getActiveSource();

  const [view, setView] = useState(isLoggedIn ? 'account' : 'qr');
  const [qrPhase, setQrPhase] = useState('loading'); // loading|waiting|scanned|confirmed|expired|error
  const [qrImage, setQrImage] = useState('');
  const [qrTip, setQrTip] = useState('');
  const [playlists, setPlaylists] = useState(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  const qrKeyRef = useRef('');
  const qrCtxRef = useRef({});
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // 发起扫码：取二维码 + 启动轮询（音源无关）
  const startQr = useCallback(async () => {
    stopPolling();
    setQrPhase('loading');
    setQrTip('正在生成登录二维码…');
    try {
      const r = await src.qrCreate();
      qrKeyRef.current = r.key || '';
      qrCtxRef.current = { login_sig: r.login_sig };
      setQrImage(r.qrcode || '');
      setQrPhase('waiting');
      setQrTip(`请用${src.name}App 扫码登录`);
      pollRef.current = setInterval(async () => {
        try {
          const st = await src.qrCheck(qrKeyRef.current, qrCtxRef.current);
          if (st.status === 'scanned') {
            setQrPhase('scanned');
            setQrTip('已扫描，请在手机上确认登录');
          } else if (st.status === 'confirmed') {
            stopPolling();
            setQrPhase('confirmed');
            setQrTip('登录成功，正在同步账号…');
            setAuth({
              cookie: st.cookie || '',
              uin: st.uid || '',
              key: st.key || '',
              nickname: st.nickname || (src.id === 'qq' ? 'QQ音乐用户' : '网易云用户'),
            });
            setView('account');
          } else if (st.status === 'expired') {
            setQrPhase('expired');
            setQrTip('二维码已失效，请点击刷新');
            stopPolling();
          }
        } catch (e) {
          // 单次轮询失败不中断，下次继续
        }
      }, 1500);
    } catch (e) {
      setQrPhase('error');
      setQrTip('生成二维码失败：' + (e.message || ''));
    }
  }, [src, stopPolling]);

  // 进入登录页或切换音源时重新发起扫码
  useEffect(() => {
    if (view !== 'qr') return;
    if (src.loginMethod !== 'qr' || typeof src.qrCreate !== 'function') {
      setQrPhase('unsupported');
      setQrTip(`${src.name} 登录开发中，敬请期待`);
      return;
    }
    startQr();
    return stopPolling;
  }, [view, src.id, startQr, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

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
    setQrImage('');
    setQrTip('');
    setQrPhase('loading');
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
        <QrLoginView phase={qrPhase} tip={qrTip} image={qrImage} sourceName={src.name} onRefresh={startQr} onBack={onBack} />
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

function QrLoginView({ phase, tip, image, sourceName, onRefresh }) {
  const isScanned = phase === 'scanned';
  const isExpired = phase === 'expired';
  const isLoading = phase === 'loading';
  const isUnsupported = phase === 'unsupported';
  return (
    <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div className="glass-panel-strong" style={{ padding: 32, borderRadius: 26, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 68, height: 68, borderRadius: 20, background: 'linear-gradient(135deg, var(--accent-dynamic), #00c9a7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 34px rgba(0, 245, 212, 0.32)' }}>
          <QrCode size={30} color="#050608" />
        </div>

        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>扫码登录{sourceName}</div>

        {/* 二维码区域 */}
        <div style={{
          width: 220, height: 220, borderRadius: 16, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 12, position: 'relative', overflow: 'hidden',
          boxShadow: isScanned ? '0 0 0 3px #7ee2a8, 0 12px 36px rgba(0,0,0,0.32)' : '0 12px 36px rgba(0,0,0,0.32)',
        }}>
          {isUnsupported ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#444', textAlign: 'center', padding: 12 }}>
              <QrCode size={40} color="#bbb" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>登录开发中</span>
            </div>
          ) : image ? (
            <img src={image} alt="login qr" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <Loader2 size={36} className="spin-icon" color="#050608" />
          )}
          {isScanned && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(126,226,168,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0a7', fontWeight: 800 }}>
              <CheckCircle2 size={56} color="#0a7" />
            </div>
          )}
          {isExpired && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button onClick={onRefresh} className="glass-button-accent" style={{ padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#050608', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> 刷新二维码
              </button>
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6, minHeight: 20 }}>
          {isLoading ? '正在生成二维码…' : isScanned ? '已扫描，请在手机上确认' : isExpired ? '二维码已失效' : isUnsupported ? '该音源登录尚未开放' : `请用${sourceName}App 扫码`}
        </div>
      </div>

      {tip && (
        <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', color: phase === 'confirmed' ? '#7ee2a8' : phase === 'error' ? '#ff9fa6' : 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5 }}>{tip}</div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
        登录后即可听 VIP 歌曲 + 同步歌单<br />扫码状态在本地轮询，登录信息安全同步
      </div>
    </div>
  );
}
