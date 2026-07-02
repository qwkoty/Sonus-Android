import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ChevronRight, ArrowLeft } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';

// 扫码状态文案
const STATUS_TEXT = {
  66: '请使用 QQ 扫描二维码',
  67: '扫描成功，请在手机上确认登录',
  0: '登录成功，正在进入…',
};

export default function Login({ onBack }) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [qrsig, setQrsig] = useState('');
  const [qrcode, setQrcode] = useState('');
  const [status, setStatus] = useState(66); // 66 等待扫码 / 67 已扫码待确认 / 0 成功
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef(null);
  const qrsigRef = useRef('');

  const fetchQr = async () => {
    setLoadingQr(true);
    setErrorMsg('');
    setStatus(66);
    setDone(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      setQrsig(data.qrsig);
      qrsigRef.current = data.qrsig;
      setQrcode(data.qrcode);
      startPolling(data.qrsig);
    } catch (e) {
      setErrorMsg(e.message || '获取二维码失败，请重试');
    } finally {
      setLoadingQr(false);
    }
  };

  const startPolling = (sig) => {
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    stop();
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    pollRef.current = setInterval(async () => {
      if (stopped || !qrsigRef.current) return;
      try {
        const res = await music.loginCheck(qrsigRef.current);
        // res: { code, msg, cookie?, uin?, key?, nickname? }
        const code = Number(res?.code);
        if (code === 66) {
          setStatus(66);
        } else if (code === 67) {
          setStatus(67);
        } else if (code === 0 && res?.cookie && res?.uin) {
          stop();
          setStatus(0);
          setDone(true);
          setAuth({
            cookie: res.cookie,
            uin: res.uin,
            key: res.key,
            nickname: res.nickname,
          });
        } else if (code === 65) {
          // 二维码失效
          stop();
          setErrorMsg('二维码已过期，请刷新');
          setStatus(66);
        } else {
          // 其他错误码继续等待
          setStatus(66);
        }
      } catch (e) {
        // 网络抖动忽略，继续轮询
      }
    }, 2000);
  };

  useEffect(() => {
    fetchQr();
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 35%, #1a1a22 0%, #0A0A0A 70%)',
    }}>
      {/* 背景光晕 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 40%, rgba(79,195,247,0.08), transparent 55%)',
      }} />

      <div style={{
        position: 'relative', zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
        padding: '40px 32px', maxWidth: 360, width: '90%',
      }}>
        {/* 返回按钮 */}
        {onBack && (
          <button onClick={onBack} style={{
            position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', left: 16,
            width: 40, height: 40, borderRadius: 12,
            background: 'var(--glass-1)', backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-primary)', cursor: 'pointer',
          }}>
            <ArrowLeft size={18} />
          </button>
        )}

        {/* Logo / 标题 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #4FC3F7, #6C5CE7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(79,195,247,0.35)',
          }}>
            <Music size={28} color="#fff" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Sonus</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              登录 QQ 音乐，同步你的歌单
            </div>
          </div>
        </div>

        {/* 二维码卡片 */}
        <div style={{
          position: 'relative',
          width: 220, height: 220, borderRadius: 24,
          background: '#fff', padding: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}>
          {loadingQr && (
            <div style={{
              position: 'absolute', inset: 14, borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#fff',
            }}>
              <Loader2 size={28} color="#999" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          {qrcode && !loadingQr && (
            <img src={qrcode} alt="QQ 登录二维码"
              style={{
                width: '100%', height: '100%', objectFit: 'contain', borderRadius: 14,
                // QQ 原始二维码仅 ~111px，用 pixelated 放大保持像素清晰
                imageRendering: 'pixelated',
                filter: done ? 'blur(6px) brightness(1.3)' : 'none',
                transition: 'filter 0.4s ease',
              }} />
          )}
          {done && (
            <div style={{
              position: 'absolute', inset: 14, borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)',
            }}>
              <Loader2 size={32} color="#4FC3F7" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          {/* 失效遮罩 */}
          {errorMsg === '二维码已过期，请刷新' && (
            <div style={{
              position: 'absolute', inset: 14, borderRadius: 14,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              background: 'rgba(20,20,24,0.88)', backdropFilter: 'blur(4px)',
            }}>
              <span style={{ fontSize: 12, color: '#fff' }}>二维码已过期</span>
              <button onClick={fetchQr} style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fff',
                padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.14)',
              }}>
                <RefreshCw size={13} /> 点击刷新
              </button>
            </div>
          )}
        </div>

        {/* 状态文案 */}
        <div style={{ textAlign: 'center', minHeight: 20 }}>
          {errorMsg && errorMsg !== '二维码已过期，请刷新' ? (
            <span style={{ fontSize: 13, color: '#F87171' }}>{errorMsg}</span>
          ) : (
            <span style={{
              fontSize: 13,
              color: status === 0 ? '#4ADE80' : 'var(--text-secondary)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {status === 0 && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              {STATUS_TEXT[status] || '加载中…'}
            </span>
          )}
        </div>

        {/* 刷新按钮 */}
        {!done && (
          <button onClick={fetchQr} disabled={loadingQr} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-secondary)', cursor: loadingQr ? 'wait' : 'pointer',
            padding: '8px 16px', borderRadius: 20,
            border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)',
          }}>
            <RefreshCw size={13} /> 刷新二维码
          </button>
        )}

        {/* 说明 */}
        <div style={{
          marginTop: 8, padding: '12px 14px', borderRadius: 14,
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        }}>
          <ChevronRight size={14} color="var(--text-secondary)" />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            扫码登录后即可同步你的 QQ 音乐歌单
          </span>
        </div>
      </div>
    </div>
  );
}
