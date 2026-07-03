import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrCheckJsonp } from '../utils/qqLogin';

// 流程：
// 1. 进入页面 → 显示二维码 + "请使用 QQ 扫描二维码"
// 2. 用户去手机 QQ 扫码 + 确认登录
// 3. 用户点"我已扫码"按钮 → 一次性请求 ptqrlogin 检查
//    - code 0：后端收集 cookie → setAuth → 拉取昵称/头像 → 进播放器（歌单在 Profile 页拉）
//    - code 67：提示"已扫码，请在手机上确认登录后再次点击"
//    - code 66：提示"还未检测到扫码"
//    - code 65：二维码过期
export default function Login({ onBack }) {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [qrcode, setQrcode] = useState('');
  const [loadingQr, setLoadingQr] = useState(true);
  // 'idle'：等待用户扫码+点按钮；'logging'：点了按钮后的登录流程中
  const [phase, setPhase] = useState('idle');
  const [tip, setTip] = useState('请使用 QQ 扫描二维码');
  const [errorMsg, setErrorMsg] = useState('');
  const qrsigRef = useRef('');

  const fetchQr = async () => {
    setLoadingQr(true);
    setErrorMsg('');
    setPhase('idle');
    setTip('请使用 QQ 扫描二维码');
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      qrsigRef.current = data.qrsig;
      setQrcode(data.qrcode);
    } catch (e) {
      setErrorMsg(e.message || '获取二维码失败');
      setQrcode('');
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    fetchQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用户点"我已扫码"：一次性检查 + 登录
  const onScanned = async () => {
    if (!qrsigRef.current || phase === 'logging') return;
    setPhase('logging');
    setErrorMsg('');
    setTip('正在登录…');
    try {
      const res = await qqQrCheckJsonp(qrsigRef.current);

      if (res.code === 0 && res.redirectUrl) {
        // 检查通过，后端收集 cookie
        const loginRes = await music.loginByRedirect(res.redirectUrl, qrsigRef.current);
        if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
          setAuth({
            cookie: loginRes.cookie,
            uin: loginRes.uin,
            key: loginRes.key,
            nickname: res.nickname || loginRes.nickname || 'QQ音乐用户',
          });
          // setAuth 触发 fetchUserInfo（拉昵称+头像）+ App 自动切到播放器
          // 歌单在 Profile 页加载
          return;
        }
        setErrorMsg(loginRes?.msg || '登录信息收集失败，请刷新重试');
        setTip('请使用 QQ 扫描二维码');
      } else if (res.code === 67) {
        setErrorMsg('已扫码，请在手机上确认登录后再次点击');
        setTip('请使用 QQ 扫描二维码');
      } else if (res.code === 66) {
        setErrorMsg('还未检测到扫码，请先用 QQ 扫描二维码');
        setTip('请使用 QQ 扫描二维码');
      } else if (res.code === 65) {
        setErrorMsg('二维码已过期，请刷新');
        setTip('二维码已过期');
      } else {
        setErrorMsg(res.msg || '登录失败，请重试');
        setTip('请使用 QQ 扫描二维码');
      }
    } catch (e) {
      setErrorMsg('网络错误：' + (e.message || ''));
      setTip('请使用 QQ 扫描二维码');
    }
    setPhase('idle');
  };

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
                filter: phase === 'logging' ? 'blur(6px) opacity(0.4)' : 'none',
                transition: 'filter 0.3s ease',
              }}
            />
            {phase === 'logging' && (
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
        marginTop: 24, fontSize: 15, fontWeight: 600, textAlign: 'center',
        color: 'var(--text-secondary)', zIndex: 1,
      }}>
        {tip}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div style={{
          marginTop: 8, fontSize: 12, color: '#F87171', textAlign: 'center', zIndex: 1,
          maxWidth: 280, lineHeight: 1.5,
        }}>
          {errorMsg}
        </div>
      )}

      {/* "我已扫码"按钮：登录流程中隐藏 */}
      {qrcode && phase === 'idle' && (
        <button onClick={onScanned} style={{
          marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 28px', borderRadius: 14, cursor: 'pointer',
          fontSize: 14, fontWeight: 700,
          background: 'var(--accent-dynamic)', color: '#0A0A0A',
          border: 'none', zIndex: 1,
          boxShadow: '0 8px 24px rgba(79,195,247,0.35)',
        }}>
          <CheckCircle2 size={16} /> 我已扫码
        </button>
      )}

      {/* 刷新二维码按钮：登录流程中隐藏 */}
      {!loadingQr && phase !== 'logging' && (
        <button onClick={fetchQr} style={{
          marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
          fontSize: 12, fontWeight: 500,
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', zIndex: 1,
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
