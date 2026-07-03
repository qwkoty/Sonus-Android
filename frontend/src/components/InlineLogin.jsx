import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrCheckJsonp } from '../utils/qqLogin';

// 扫码状态：66 等待 / 67 已扫码 / 0 成功 / 65 失效
const STATUS_TEXT = {
  66: '请使用 QQ 扫描二维码',
  67: '二维码扫描成功，请在手机上确认',
  0: '登录成功，正在进入…',
};

export default function InlineLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);

  // 扫码登录（主登录方式，JSONP 从用户浏览器直接请求 QQ）
  const [qrcode, setQrcode] = useState('');
  const [status, setStatus] = useState(66);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
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
      setErrorMsg(e.message || '获取二维码失败');
    } finally {
      setLoadingQr(false);
    }
  };

  const startPolling = (sig) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!qrsigRef.current) return;
      try {
        // 前端 JSONP 直接请求 QQ ptqrlogin，不经过服务器
        const res = await qqQrCheckJsonp(qrsigRef.current);

        if (res.code === 66) {
          setStatus(66);
        } else if (res.code === 67) {
          setStatus(67);
        } else if (res.code === 0 && res.redirectUrl) {
          // 登录成功，调后端收集 cookie
          stopPolling();
          setStatus(0);
          try {
            const loginRes = await music.loginByRedirect(res.redirectUrl, qrsigRef.current);
            if (Number(loginRes?.code) === 0 && loginRes?.cookie && loginRes?.uin) {
              setAuth({
                cookie: loginRes.cookie,
                uin: loginRes.uin,
                key: loginRes.key,
                nickname: res.nickname || loginRes.nickname || 'QQ音乐用户',
              });
            } else {
              setErrorMsg(loginRes?.msg || '登录信息收集失败，请重试');
              setStatus(66);
            }
          } catch (e) {
            setErrorMsg('登录信息收集失败：' + (e.message || '网络错误'));
            setStatus(66);
          }
        } else if (res.code === 65) {
          stopPolling();
          setErrorMsg('二维码已过期，请刷新');
          setStatus(66);
        } else if (res.code === -1) {
          // 网络错误，继续轮询不中断
        } else {
          setStatus(66);
        }
      } catch (e) {
        // 网络抖动忽略，继续轮询
      }
    }, 2000);
  };

  useEffect(() => {
    fetchQr();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* 扫码登录 */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        padding: '20px 16px', borderRadius: 16,
        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
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
    </>
  );
}
