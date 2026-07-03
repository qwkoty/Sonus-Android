import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, User, QrCode } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';

// 状态码：66 等待扫码 / 67 已扫码待确认 / 0 成功 / 65 失效
const STATUS_TEXT = {
  66: '请使用 QQ 扫描二维码',
  67: '二维码扫描成功，请在手机上确认',
  0: '登录成功，正在进入…',
};

// 内联二维码登录：嵌入"我的"面板，点头像区域展开二维码 + 状态
export default function InlineLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [qrcode, setQrcode] = useState('');
  const [status, setStatus] = useState(66);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const [expanded, setExpanded] = useState(false);   // 是否展开二维码
  const pollRef = useRef(null);
  const qrsigRef = useRef('');

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const fetchQr = async () => {
    setLoadingQr(true);
    setErrorMsg('');
    setStatus(66);
    stopPolling();
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
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
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!qrsigRef.current) return;
      try {
        const res = await music.loginCheck(qrsigRef.current);
        const code = Number(res?.code);
        if (code === 66) {
          setStatus(66);
        } else if (code === 67) {
          setStatus(67);
        } else if (code === 0 && res?.cookie && res?.uin) {
          stopPolling();
          setStatus(0);
          setAuth({
            cookie: res.cookie,
            uin: res.uin,
            key: res.key,
            nickname: res.nickname,
          });
        } else if (code === 0 && (!res?.cookie || !res?.uin)) {
          stopPolling();
          setErrorMsg('登录信息收集失败，请重试');
          setStatus(66);
        } else if (code === 65) {
          stopPolling();
          setErrorMsg('二维码已过期，请刷新');
          setStatus(66);
        } else if (code === 800) {
          stopPolling();
          setErrorMsg(res?.msg || '登录失败，请重试');
          setStatus(66);
        } else {
          setStatus(66);
        }
      } catch (e) {
        // 网络抖动忽略，继续轮询
      }
    }, 2000);
  };

  // 展开时自动拉取二维码，收起/卸载时停止轮询
  useEffect(() => {
    if (expanded && !qrcode && !loadingQr) fetchQr();
    return () => { if (!expanded) stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => () => stopPolling(), []);

  const handleToggle = () => {
    setExpanded((v) => {
      const next = !v;
      if (!next) stopPolling();
      return next;
    });
  };

  return (
    <>
      {/* 头像区域（可点击展开/收起二维码） */}
      <button
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 14, width: '100%',
          padding: '14px 12px', marginBottom: 8, cursor: 'pointer',
          borderRadius: 16, background: expanded ? 'rgba(79,195,247,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${expanded ? 'var(--accent-dynamic)' : 'var(--border)'}`,
          transition: 'background 0.2s ease, border-color 0.2s ease',
        }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(79,195,247,0.25), rgba(108,92,231,0.25))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <User size={24} color="var(--accent-dynamic)" />
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            登录 QQ 音乐
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            {expanded ? (loadingQr ? '正在加载二维码…' : '扫码解锁 VIP 与歌单同步') : '点击此处显示二维码'}
          </div>
        </div>
        {expanded
          ? <QrCode size={18} color="var(--accent-dynamic)" />
          : <User size={16} color="var(--text-muted)" />
        }
      </button>

      {/* 二维码 + 状态 */}
      {expanded && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          padding: '20px 16px 24px', marginBottom: 8,
          borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
        }}>
          {loadingQr && !qrcode ? (
            <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
            </div>
          ) : qrcode ? (
            <div style={{ position: 'relative' }}>
              <img
                src={qrcode}
                alt="登录二维码"
                style={{
                  width: 180, height: 180, borderRadius: 12,
                  imageRendering: 'pixelated',
                  background: '#fff', padding: 8,
                  filter: status === 0 ? 'blur(4px) opacity(0.5)' : 'none',
                  transition: 'filter 0.3s ease',
                }}
              />
              {status === 0 && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent-dynamic)', fontSize: 14, fontWeight: 700,
                }}>
                  登录成功
                </div>
              )}
            </div>
          ) : (
            <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 20 }}>
              {errorMsg || '二维码加载失败'}
            </div>
          )}

          {/* 状态文案 */}
          <div style={{
            fontSize: 13, fontWeight: 600, textAlign: 'center',
            color: status === 0 ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
          }}>
            {STATUS_TEXT[status] || '请扫描二维码'}
          </div>

          {/* 错误 + 刷新 */}
          {errorMsg && status !== 0 && (
            <button onClick={fetchQr} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: 'rgba(79,195,247,0.12)', border: '1px solid var(--accent-dynamic)',
              color: 'var(--accent-dynamic)',
            }}>
              <RefreshCw size={13} /> 刷新二维码
            </button>
          )}
        </div>
      )}
    </>
  );
}
