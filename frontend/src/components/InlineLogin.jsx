import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, User, KeyRound, QrCode, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';

// 扫码状态：66 等待 / 67 已扫码 / 0 成功 / 65 失效
const STATUS_TEXT = {
  66: '请使用 QQ 扫描二维码',
  67: '二维码扫描成功，请在手机上确认',
  0: '登录成功，正在进入…',
};

export default function InlineLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);

  // Cookie 导入（主登录方式）
  const [cookieInput, setCookieInput] = useState('');
  const [cookieLoading, setCookieLoading] = useState(false);
  const [cookieError, setCookieError] = useState('');

  // 扫码（备选，服务器 IP 被 QQ 风控时可能不可用）
  const [showQr, setShowQr] = useState(false);
  const [qrcode, setQrcode] = useState('');
  const [status, setStatus] = useState(66);
  const [qrError, setQrError] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const pollRef = useRef(null);
  const qrsigRef = useRef('');

  // ===== Cookie 导入 =====
  const handleCookieLogin = async () => {
    const cookie = cookieInput.trim();
    if (!cookie) { setCookieError('请粘贴 Cookie'); return; }
    setCookieLoading(true);
    setCookieError('');
    try {
      const res = await music.loginByCookie(cookie);
      if (Number(res?.code) === 0 && res?.cookie && res?.uin) {
        setAuth({
          cookie: res.cookie,
          uin: res.uin,
          key: res.key,
          nickname: res.nickname,
        });
      } else {
        setCookieError(res?.msg || 'Cookie 无效或已过期');
      }
    } catch (e) {
      setCookieError(e.message || '登录失败，请重试');
    } finally {
      setCookieLoading(false);
    }
  };

  // ===== 扫码（备选）=====
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const fetchQr = async () => {
    setLoadingQr(true);
    setQrError('');
    setStatus(66);
    stopPolling();
    try {
      const data = await music.loginQrCode();
      if (!data?.qrsig || !data?.qrcode) throw new Error('二维码获取失败');
      qrsigRef.current = data.qrsig;
      setQrcode(data.qrcode);
      startPolling(data.qrsig);
    } catch (e) {
      setQrError(e.message || '获取二维码失败');
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
          setAuth({ cookie: res.cookie, uin: res.uin, key: res.key, nickname: res.nickname });
        } else if (code === 0 && (!res?.cookie || !res?.uin)) {
          stopPolling();
          setQrError('登录信息收集失败，请用 Cookie 导入');
          setStatus(66);
        } else if (code === 65) {
          stopPolling();
          setQrError('二维码已过期');
          setStatus(66);
        } else if (code === 800) {
          stopPolling();
          setQrError(res?.msg || '登录失败');
          setStatus(66);
        } else {
          setStatus(66);
        }
      } catch (e) {}
    }, 2000);
  };

  useEffect(() => {
    if (showQr && !qrcode && !loadingQr) fetchQr();
    return () => { if (!showQr) stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr]);

  useEffect(() => () => stopPolling(), []);

  return (
    <>
      {/* Cookie 导入（推荐）*/}
      <div style={{
        padding: '16px 14px', marginBottom: 8, borderRadius: 16,
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <KeyRound size={16} color="var(--accent-dynamic)" />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Cookie 导入登录</span>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(79,195,247,0.15)', color: 'var(--accent-dynamic)', fontWeight: 600 }}>推荐</span>
        </div>

        <textarea
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          placeholder="粘贴 QQ 音乐 Cookie…"
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10,
            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace',
            resize: 'none', outline: 'none', boxSizing: 'border-box',
          }}
        />

        {cookieError && (
          <div style={{ fontSize: 12, color: '#F87171', marginTop: 8, padding: '0 4px' }}>{cookieError}</div>
        )}

        <button
          onClick={handleCookieLogin}
          disabled={cookieLoading || !cookieInput.trim()}
          style={{
            marginTop: 10, width: '100%', padding: '11px', borderRadius: 12, cursor: 'pointer',
            background: cookieLoading || !cookieInput.trim() ? 'rgba(255,255,255,0.06)' : 'var(--accent-dynamic)',
            border: 'none', color: cookieLoading || !cookieInput.trim() ? 'var(--text-muted)' : '#0A0A0A',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {cookieLoading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <User size={15} />}
          {cookieLoading ? '正在验证…' : '登录'}
        </button>

        {/* 操作步骤 */}
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <ExternalLink size={11} />
            <a href="https://y.qq.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-dynamic)' }}>
              打开 y.qq.com 并扫码登录
            </a>
          </div>
          <div>2. 按 F12 → Network → 刷新页面</div>
          <div>3. 点任意请求 → Headers → 复制 Cookie 值</div>
          <div>4. 粘贴到上方输入框点登录</div>
        </div>
      </div>

      {/* 扫码登录（备选）*/}
      <button
        onClick={() => setShowQr((v) => !v)}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <QrCode size={15} />
        扫码登录
        {showQr ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {showQr && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          padding: '20px 16px', marginTop: 8, borderRadius: 16,
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            服务器 IP 被 QQ 风控时扫码可能无效，建议用 Cookie 导入
          </div>

          {loadingQr && !qrcode ? (
            <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
            </div>
          ) : qrcode ? (
            <img src={qrcode} alt="二维码" style={{
              width: 160, height: 160, borderRadius: 10, imageRendering: 'pixelated',
              background: '#fff', padding: 6,
              filter: status === 0 ? 'blur(4px) opacity(0.5)' : 'none',
            }} />
          ) : (
            <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 16 }}>
              {qrError || '加载失败'}
            </div>
          )}

          <div style={{
            fontSize: 12, fontWeight: 600, textAlign: 'center',
            color: status === 0 ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
          }}>
            {STATUS_TEXT[status] || '请扫描二维码'}
          </div>

          {qrError && status !== 0 && (
            <button onClick={fetchQr} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: 'rgba(79,195,247,0.12)', border: '1px solid var(--accent-dynamic)',
              color: 'var(--accent-dynamic)',
            }}>
              <RefreshCw size={12} /> 刷新二维码
            </button>
          )}
        </div>
      )}
    </>
  );
}
