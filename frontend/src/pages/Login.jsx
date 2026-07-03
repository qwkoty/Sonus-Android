import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrPoll } from '../utils/qqLogin';

// 自动轮询扫码登录流程：
// 1. 进入页面 → 获取二维码 + qrsig → 自动开始轮询
// 2. 前端 JSONP 轮询 ptqrlogin（从用户浏览器发出，绕过服务器 IP 风控）
// 3. code 0 → POST 后端 /login/qq/redirect 收集 cookie → setAuth → 进播放器
// 4. code 65 → 二维码过期，提示刷新
export default function Login({ onBack }) {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [qrcode, setQrcode] = useState('');
  // phase: loading(获取二维码中) | waiting(等待扫码) | scanned(已扫码待确认) | logging(收集中) | expired(过期) | error
  const [phase, setPhase] = useState('loading');
  const [tip, setTip] = useState('正在加载二维码…');
  const [errorMsg, setErrorMsg] = useState('');
  const qrsigRef = useRef('');
  const stopPollRef = useRef(null);

  const fetchQr = async () => {
    // 停止旧轮询
    if (stopPollRef.current) { stopPollRef.current(); stopPollRef.current = null; }
    setPhase('loading');
    setTip('正在加载二维码…');
    setErrorMsg('');
    setQrcode('');
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      qrsigRef.current = data.qrsig;
      setQrcode(data.qrcode);
      setPhase('waiting');
      setTip('请使用 QQ 扫描二维码');
      startPoll(data.qrsig);
    } catch (e) {
      setErrorMsg(e.message || '获取二维码失败');
      setPhase('error');
      setTip('二维码加载失败');
    }
  };

  const startPoll = (qrsig) => {
    if (stopPollRef.current) { stopPollRef.current(); stopPollRef.current = null; }
    stopPollRef.current = qqQrPoll(qrsig, {
      onWaiting: () => {
        if (phase !== 'logging') {
          setPhase('waiting');
          setTip('请使用 QQ 扫描二维码');
        }
      },
      onScanned: () => {
        setPhase('scanned');
        setTip('已扫码，请在手机上确认登录');
        setErrorMsg('');
      },
      onSuccess: async (redirectUrl, nickname) => {
        setPhase('logging');
        setTip('正在登录…');
        setErrorMsg('');
        try {
          const loginRes = await music.loginByRedirect(redirectUrl, qrsigRef.current);
          if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
            setAuth({
              cookie: loginRes.cookie,
              uin: loginRes.uin,
              key: loginRes.key,
              nickname: nickname || loginRes.nickname || 'QQ音乐用户',
            });
            // setAuth 触发 fetchUserInfo + App 自动切到播放器
            return;
          }
          setErrorMsg(loginRes?.msg || '登录信息收集失败，请刷新重试');
          setPhase('error');
          setTip('登录失败');
        } catch (e) {
          setErrorMsg('登录失败：' + (e.message || ''));
          setPhase('error');
          setTip('登录失败');
        }
      },
      onExpired: () => {
        setPhase('expired');
        setTip('二维码已过期');
        setErrorMsg('二维码已过期，请刷新');
      },
      onError: (msg) => {
        setErrorMsg(msg);
      },
    });
  };

  useEffect(() => {
    fetchQr();
    return () => {
      if (stopPollRef.current) stopPollRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBusy = phase === 'loading' || phase === 'logging';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 100%)',
      padding: 20, overflow: 'hidden',
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
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36,
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

      {/* 二维码卡片 - 液态玻璃 */}
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
                filter: phase === 'logging' ? 'blur(6px) opacity(0.4)' : phase === 'scanned' ? 'brightness(0.85)' : 'none',
                transition: 'filter 0.3s ease',
              }}
            />
            {/* 扫码成功对勾覆盖 */}
            {phase === 'scanned' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 48, color: '#4ADE80',
                textShadow: '0 0 20px rgba(74,222,128,0.6)',
              }}>
                ✓
              </div>
            )}
            {/* 登录中 loading */}
            {phase === 'logging' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
              </div>
            )}
            {/* 过期遮罩 */}
            {phase === 'expired' && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 16,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <button onClick={fetchQr} className="glass-button" style={{
                  padding: '8px 16px', borderRadius: 10,
                  fontSize: 13, fontWeight: 600, color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <RefreshCw size={14} /> 点击刷新
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            width: 200, height: 200,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20, gap: 12,
          }}>
            <span>{errorMsg || '二维码加载失败'}</span>
          </div>
        )}
      </div>

      {/* 状态文案 */}
      <div style={{
        marginTop: 24, fontSize: 15, fontWeight: 600, textAlign: 'center',
        color: phase === 'scanned' ? '#4ADE80' : phase === 'logging' ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
        zIndex: 1, transition: 'color 0.3s ease',
      }}>
        {tip}
      </div>

      {/* 错误提示 */}
      {errorMsg && phase !== 'expired' && (
        <div style={{
          marginTop: 8, fontSize: 12, color: '#F87171', textAlign: 'center', zIndex: 1,
          maxWidth: 280, lineHeight: 1.5,
        }}>
          {errorMsg}
        </div>
      )}

      {/* 刷新按钮：非忙碌状态显示 */}
      {qrcode && !isBusy && (
        <button onClick={fetchQr} className="glass-button" style={{
          marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', borderRadius: 10,
          fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
          zIndex: 1,
        }}>
          <RefreshCw size={13} /> 刷新二维码
        </button>
      )}

      {/* 底部提示 */}
      <div style={{
        position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))',
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', zIndex: 1,
        padding: '0 24px',
      }}>
        请使用已安装 QQ 的手机扫码并确认登录 · 仅用于解锁 VIP 与同步歌单
      </div>
    </div>
  );
}
