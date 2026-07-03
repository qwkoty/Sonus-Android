import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrCheckJsonp } from '../utils/qqLogin';

// 扫码状态：66 等待扫码 / 67 已扫码待确认 / 0 成功 / 65 失效
const STATUS = {
  66: { text: '请使用 QQ 扫描二维码', color: 'var(--text-secondary)' },
  67: { text: '扫描成功，请在手机上确认登录', color: 'var(--accent-dynamic)' },
  0:  { text: '登录成功，正在进入…', color: 'var(--accent-dynamic)' },
};

export default function Login({ onBack }) {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [qrcode, setQrcode] = useState('');
  const [qrsig, setQrsig] = useState('');
  const [status, setStatus] = useState(66);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingQr, setLoadingQr] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const pollRef = useRef(null);
  const qrsigRef = useRef('');

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const fetchQr = async () => {
    setLoadingQr(true);
    setErrorMsg('');
    setStatus(66);
    setCollecting(false);
    stopPolling();
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      qrsigRef.current = data.qrsig;
      setQrsig(data.qrsig);
      setQrcode(data.qrcode);
      startPolling(data.qrsig);
    } catch (e) {
      setErrorMsg(e.message || '获取二维码失败');
    } finally {
      setLoadingQr(false);
    }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!qrsigRef.current) return;
      try {
        const res = await qqQrCheckJsonp(qrsigRef.current);

        if (res.code === 66) {
          setStatus(66);
        } else if (res.code === 67) {
          setStatus(67);
        } else if (res.code === 0 && res.redirectUrl) {
          stopPolling();
          setStatus(0);
          setCollecting(true);
          try {
            const loginRes = await music.loginByRedirect(res.redirectUrl, qrsigRef.current);
            if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
              setAuth({
                cookie: loginRes.cookie,
                uin: loginRes.uin,
                key: loginRes.key,
                nickname: res.nickname || loginRes.nickname || 'QQ音乐用户',
              });
              // setAuth 会触发 App 切换到 Player，无需在此处理跳转
            } else {
              setErrorMsg(loginRes?.msg || '登录信息收集失败，请刷新重试');
              setStatus(66);
              setCollecting(false);
            }
          } catch (e) {
            setErrorMsg('登录信息收集失败：' + (e.message || '网络错误'));
            setStatus(66);
            setCollecting(false);
          }
        } else if (res.code === 65) {
          stopPolling();
          setErrorMsg('二维码已过期');
          setStatus(66);
        }
        // code === -1（网络错误）：静默继续轮询
      } catch (e) {
        // 网络抖动忽略
      }
    }, 2000);
  };

  useEffect(() => {
    fetchQr();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusInfo = STATUS[status] || STATUS[66];

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 100%)',
      padding: 20, overflow: 'hidden',
    }}>
      {/* 背景装饰光晕 */}
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, var(--accent-dynamic) 0%, transparent 70%)',
        opacity: 0.08, filter: 'blur(40px)',
        top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }} />

      {/* 左上角返回按钮（不登录也能用） */}
      {onBack && (
        <button onClick={onBack} style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 16,
          width: 40, height: 40, borderRadius: 12, cursor: 'pointer',
          background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-primary)', zIndex: 2,
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

      {/* 二维码卡片 */}
      <div style={{
        position: 'relative', zIndex: 1,
        padding: 18, borderRadius: 24,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {loadingQr ? (
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
                filter: (status === 0 || collecting) ? 'blur(6px) opacity(0.4)' : 'none',
                transition: 'filter 0.3s ease',
              }}
            />
            {(status === 0 || collecting) && (
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
            <span>{errorMsg || '二维码加载失败'}</span>
          </div>
        )}
      </div>

      {/* 状态文案 */}
      <div style={{
        marginTop: 28, fontSize: 15, fontWeight: 600, textAlign: 'center',
        color: statusInfo.color, zIndex: 1,
        transition: 'color 0.3s ease',
      }}>
        {collecting ? '正在获取登录信息…' : statusInfo.text}
      </div>

      {/* 错误提示 + 刷新按钮 */}
      {errorMsg && status !== 0 && !collecting && (
        <button onClick={fetchQr} style={{
          marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 12, cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          background: 'rgba(79,195,247,0.1)', border: '1px solid var(--accent-dynamic)',
          color: 'var(--accent-dynamic)', zIndex: 1,
        }}>
          <RefreshCw size={14} /> 刷新二维码
        </button>
      )}

      {/* 底部提示 */}
      <div style={{
        position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))',
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', zIndex: 1,
      }}>
        请使用已安装 QQ 的手机扫码 · 仅用于解锁 VIP 与同步歌单
      </div>
    </div>
  );
}
