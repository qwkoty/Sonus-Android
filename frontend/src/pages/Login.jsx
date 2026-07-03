import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft, User, ListMusic, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrCheckJsonp } from '../utils/qqLogin';

// 登录流程（手动确认模式）：
// 1. 进入页面 → 请求二维码（含 login_sig）
// 2. 用户用手机扫码并在 QQ 中点"确认登录"
// 3. 用户点"我已扫码登录"按钮 → 前端 JSONP 检查 ptqrlogin 状态
// 4. 检查成功（code=0）→ 后端跟随 redirectUrl 收集 cookie → setAuth → 切到账号页
// 5. 账号页显示头像/昵称/VIP，下方"查看我的歌单"按钮按需加载
export default function Login({ onBack }) {
  const { setAuth, isLoggedIn, userInfo, cookie, uin, nickname, logout, fetchUserInfo } = useAuthStore();

  // view: 'qr' | 'account'  — 已登录显示账号页，否则显示扫码页
  const [view, setView] = useState(isLoggedIn ? 'account' : 'qr');

  // QR 模式状态
  const [qrcode, setQrcode] = useState('');
  // phase: loading | waiting | checking | error
  const [phase, setPhase] = useState('loading');
  const [tip, setTip] = useState('正在加载二维码…');
  const [errorMsg, setErrorMsg] = useState('');
  const qrsigRef = useRef('');
  const loginSigRef = useRef('');

  // 歌单状态
  const [playlists, setPlaylists] = useState(null); // null=未请求, []=空, [...]=有数据
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

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

  // 用户点击"我已扫码登录"按钮 → 一次性 JSONP 检查
  const handleConfirmLogin = async () => {
    if (!qrsigRef.current) {
      setErrorMsg('请先等待二维码加载');
      return;
    }
    setPhase('checking');
    setTip('正在检查登录状态…');
    setErrorMsg('');

    const res = await qqQrCheckJsonp(qrsigRef.current, loginSigRef.current);

    switch (res.code) {
      case 0:
        // 登录成功，后端收集 cookie
        if (res.redirectUrl) {
          setTip('登录成功，正在获取账号信息…');
          try {
            const loginRes = await music.loginByRedirect(res.redirectUrl, qrsigRef.current);
            if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
              setAuth({
                cookie: loginRes.cookie,
                uin: loginRes.uin,
                key: loginRes.key,
                nickname: res.nickname || loginRes.nickname || 'QQ音乐用户',
              });
              setView('account');
              return;
            }
            setErrorMsg(loginRes?.msg || '登录信息收集失败，请重试');
            setPhase('error');
            setTip('登录失败');
          } catch (e) {
            setErrorMsg('登录失败：' + (e.message || ''));
            setPhase('error');
            setTip('登录失败');
          }
        } else {
          setErrorMsg('登录信息异常，请刷新重试');
          setPhase('error');
          setTip('登录失败');
        }
        break;
      case 66:
        setErrorMsg('还没有扫码，请先用 QQ 扫描二维码');
        setPhase('waiting');
        setTip('请用 QQ 扫描二维码');
        break;
      case 67:
        setErrorMsg('已扫码，请在手机 QQ 上点击"确认登录"后再点此按钮');
        setPhase('waiting');
        setTip('请在手机上确认登录');
        break;
      case 65:
        setErrorMsg('二维码已过期，请刷新');
        setPhase('error');
        setTip('二维码已过期');
        break;
      default:
        setErrorMsg(res.msg || '检查失败，请确认已扫码并确认登录后再试');
        setPhase('waiting');
        setTip('请确认手机上已点击"确认登录"');
        break;
    }
  };

  // 加载歌单
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
    setTimeout(fetchQr, 100);
  };

  useEffect(() => {
    if (view === 'qr' && !qrcode) {
      fetchQr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const isBusy = phase === 'loading' || phase === 'checking';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 100%)',
      padding: 20, overflow: 'auto',
    }}>
      {/* 浮动光斑背景 */}
      <div className="glass-orb glass-orb-1" style={{ top: '15%', left: '10%' }} />
      <div className="glass-orb glass-orb-2" style={{ top: '50%', right: '5%' }} />
      <div className="glass-orb glass-orb-3" style={{ bottom: '10%', left: '30%' }} />

      {/* 返回按钮 */}
      {onBack && (
        <button onClick={onBack} className="glass-button" style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 16,
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2,
        }} title="返回播放器">
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Logo + 标题 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginTop: 50, marginBottom: 28,
        zIndex: 1,
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

          {/* 昵称 */}
          <div style={{
            fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
            marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {nickname}
            {userInfo?.vipLevel > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                color: '#1a1a2e',
              }}>
                VIP{userInfo.vipLevel}
              </span>
            )}
          </div>

          {/* UIN */}
          <div style={{
            fontSize: 12, color: 'var(--text-muted)', marginBottom: 20,
          }}>
            QQ: {uin}
          </div>

          {/* 歌单按钮 */}
          <button
            onClick={handleLoadPlaylists}
            disabled={loadingPlaylists}
            className="glass-button-accent"
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 12,
              fontSize: 14, fontWeight: 700, color: '#0A0A0A',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: loadingPlaylists ? 0.6 : 1,
            }}
          >
            {loadingPlaylists ? (
              <><Loader2 size={16} className="spin-icon" /> 加载中…</>
            ) : (
              <><ListMusic size={16} /> 查看我的歌单</>
            )}
          </button>

          {/* 歌单列表 */}
          {playlists && playlists.length > 0 && (
            <div style={{ width: '100%', marginTop: 16 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
                marginBottom: 10, paddingLeft: 4,
              }}>
                我的歌单 ({playlists.length})
              </div>
              <div style={{
                maxHeight: 300, overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {playlists.map((pl) => (
                  <div key={pl.id} className="glass-row" style={{
                    padding: '10px 12px', borderRadius: 12,
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  }} onClick={() => { /* 可扩展：跳转歌单详情 */ }}>
                    {pl.cover ? (
                      <img src={pl.cover} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
                    ) : (
                      <div style={{
                        width: 40, height: 40, borderRadius: 8,
                        background: 'rgba(255,255,255,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ListMusic size={16} color="var(--text-muted)" />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {pl.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {pl.songCount || 0} 首
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {playlists && playlists.length === 0 && (
            <div style={{
              marginTop: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center',
            }}>
              暂无歌单
            </div>
          )}

          {/* 退出登录 */}
          <button onClick={handleLogout} className="glass-button" style={{
            marginTop: 20, width: '100%', padding: '10px 16px', borderRadius: 12,
            fontSize: 13, fontWeight: 600, color: '#F87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <LogOut size={14} /> 退出登录
          </button>
        </div>
      ) : (
        /* ===== 二维码扫码页面 ===== */
        <>
          {/* 二维码卡片 */}
          <div className="glass-panel-strong" style={{
            position: 'relative', zIndex: 1,
            padding: 18, borderRadius: 24,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            {phase === 'loading' ? (
              <div style={{
                width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
              </div>
            ) : qrcode ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={qrcode}
                  alt="登录二维码"
                  style={{
                    width: 200, height: 200, borderRadius: 16,
                    imageRendering: 'pixelated',
                    background: '#fff', padding: 10,
                    display: 'block',
                    filter: phase === 'checking' ? 'blur(4px) opacity(0.5)' : 'none',
                    transition: 'filter 0.3s ease',
                  }}
                />
                {phase === 'checking' && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                width: 200, height: 200,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20, gap: 12,
              }}>
                <AlertCircle size={28} color="#F87171" />
                <span>{errorMsg || '二维码加载失败'}</span>
                <button onClick={fetchQr} className="glass-button" style={{
                  padding: '6px 14px', borderRadius: 8,
                  fontSize: 12, fontWeight: 600, color: '#fff',
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

          {/* 错误提示 */}
          {errorMsg && phase !== 'checking' && (
            <div style={{
              marginTop: 8, fontSize: 12, color: '#FBBF24', textAlign: 'center', zIndex: 1,
              maxWidth: 300, lineHeight: 1.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              {errorMsg}
            </div>
          )}

          {/* 核心按钮：我已扫码登录 */}
          {qrcode && phase !== 'loading' && (
            <button
              onClick={handleConfirmLogin}
              disabled={isBusy}
              className="glass-button-accent"
              style={{
                marginTop: 18, padding: '14px 32px', borderRadius: 14,
                fontSize: 15, fontWeight: 700, color: '#0A0A0A',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isBusy ? 0.6 : 1,
                zIndex: 1,
                boxShadow: '0 8px 30px rgba(79,195,247,0.35)',
              }}
            >
              {phase === 'checking' ? (
                <><Loader2 size={18} className="spin-icon" /> 正在检查…</>
              ) : (
                <><CheckCircle2 size={18} /> 我已扫码登录</>
              )}
            </button>
          )}

          {/* 刷新二维码 */}
          {qrcode && !isBusy && (
            <button onClick={fetchQr} className="glass-button" style={{
              marginTop: 12, padding: '8px 16px', borderRadius: 10,
              fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              zIndex: 1,
            }}>
              <RefreshCw size={13} /> 刷新二维码
            </button>
          )}

          {/* 操作指引 */}
          <div className="glass-panel" style={{
            marginTop: 18, padding: '12px 16px', borderRadius: 12, zIndex: 1,
            maxWidth: 320, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--accent-dynamic)', marginBottom: 4 }}>操作步骤</div>
            <div>1. 用手机 QQ 扫描上方二维码</div>
            <div>2. 在手机 QQ 上点击"确认登录"</div>
            <div>3. 点击上方"我已扫码登录"按钮</div>
          </div>

          {/* 底部提示 */}
          <div style={{
            marginTop: 20, marginBottom: 20,
            fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', zIndex: 1,
            padding: '0 24px', maxWidth: 400,
          }}>
            仅用于解锁 VIP 音源与同步歌单 · 登录后即可听歌
          </div>
        </>
      )}
    </div>
  );
}
