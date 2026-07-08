import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, QrCode, CheckCircle2, RefreshCw, Globe } from 'lucide-react';
import { getSource } from '../sources/registry';
import { CookieReader } from '../plugins/CookieReader';

// 可复用的扫码登录视图：
// - 供 Login 独立页使用（full 尺寸）
// - 供 Profile 账户中心内嵌使用（compact 尺寸，传入 sourceId）
// 登录成功后回调 onConfirmed({ cookie, uin, key, nickname })
export default function QrLoginView({ sourceId, onConfirmed, compact = false, onWebLogin }) {
  const src = getSource(sourceId);
  const supportsWebLogin = typeof src?.openLogin === 'function' && CookieReader.isAvailable();

  const [phase, setPhase] = useState('loading'); // loading|waiting|scanned|confirmed|expired|unsupported|error
  const [qrImage, setQrImage] = useState('');
  const [qrTip, setQrTip] = useState('');
  const qrKeyRef = useRef('');
  const qrCtxRef = useRef({});
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startQr = useCallback(async () => {
    if (!src || typeof src.qrCreate !== 'function' || src.loginMethod !== 'qr') {
      setPhase('unsupported');
      setQrTip(`${src?.name || '该音源'} 登录开发中，敬请期待`);
      return;
    }
    stopPolling();
    setPhase('loading');
    setQrTip('正在生成登录二维码…');
    try {
      const r = await src.qrCreate();
      qrKeyRef.current = r.key || '';
      qrCtxRef.current = { login_sig: r.login_sig };
      setQrImage(r.qrcode || '');
      setPhase('waiting');
      setQrTip(`请用${src.name}App 扫码登录`);
      pollRef.current = setInterval(async () => {
        try {
          const st = await src.qrCheck(qrKeyRef.current, qrCtxRef.current);
          if (st.status === 'scanned') {
            setPhase('scanned');
            setQrTip('已扫描，请在手机上确认登录');
          } else if (st.status === 'confirmed') {
            stopPolling();
            setPhase('confirmed');
            setQrTip('登录成功，正在同步账号…');
            onConfirmed && onConfirmed({
              cookie: st.cookie || '',
              uin: st.uid || '',
              key: st.key || '',
              nickname: st.nickname || (src.id === 'netease' ? '网易云用户' : 'QQ音乐用户'),
            });
          } else if (st.status === 'expired') {
            setPhase('expired');
            setQrTip('二维码已失效，请点击刷新');
            stopPolling();
          }
        } catch (e) {
          // 单次轮询失败不中断，下次继续
        }
      }, 1500);
    } catch (e) {
      setPhase('error');
      const msg = (e?.message || String(e)) || '未知错误';
      const connLike = /failed to fetch|network|ECONN|timeout|connect|404|500|无法连接|网络/i.test(msg);
      setQrTip(connLike
        ? '登录服务未连接：请先启动后端（npm start），再点击重试'
        : '二维码生成失败：' + msg);
    }
  }, [src, stopPolling, onConfirmed]);

  useEffect(() => {
    startQr();
    return stopPolling;
  }, [startQr, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const isScanned = phase === 'scanned';
  const isExpired = phase === 'expired';
  const isError = phase === 'error';
  const isLoading = phase === 'loading';
  const isUnsupported = phase === 'unsupported';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 12 : 16, width: '100%' }}>
      <div className="glass-panel-strong" style={{ padding: compact ? 20 : 32, borderRadius: 22, width: '100%', maxWidth: compact ? 320 : 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 12 : 16 }}>
        {!compact && (
          <div style={{ width: 68, height: 68, borderRadius: 20, background: 'linear-gradient(135deg, var(--accent-dynamic), #00c9a7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 34px rgba(0, 245, 212, 0.32)' }}>
            <QrCode size={30} color="#050608" />
          </div>
        )}

        {!compact && <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>扫码登录{src?.name || ''}</div>}

        <div style={{
          width: compact ? 168 : 220, height: compact ? 168 : 220, borderRadius: 16, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 12, position: 'relative', overflow: 'hidden',
          boxShadow: isScanned ? '0 0 0 3px #7ee2a8, 0 12px 36px rgba(0,0,0,0.32)' : '0 12px 36px rgba(0,0,0,0.32)',
        }}>
          {isUnsupported ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#444', textAlign: 'center', padding: 12 }}>
              <QrCode size={40} color="#bbb" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>登录开发中</span>
            </div>
          ) : qrImage ? (
            <img src={qrImage} alt="login qr" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
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
              <button onClick={startQr} className="glass-button-accent" style={{ padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#050608', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> 刷新二维码
              </button>
            </div>
          )}
          {isError && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#c0392b' }}>二维码生成失败</span>
              <span style={{ fontSize: 12, color: '#444', lineHeight: 1.5, maxHeight: 64, overflow: 'auto' }}>{qrTip}</span>
              {supportsWebLogin && (
                <button onClick={onWebLogin} className="glass-button-accent" style={{ padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#050608', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Globe size={14} /> 改用网页登录
                </button>
              )}
              <button onClick={startQr} className="glass-button" style={{ padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#050608', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> 重试
              </button>
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6, minHeight: 20 }}>
          {isLoading ? '正在生成二维码…' : isScanned ? '已扫描，请在手机上确认' : isExpired ? '二维码已失效' : isUnsupported ? '该音源登录尚未开放' : `请用${src?.name || ''}App 扫码`}
        </div>
      </div>

      {qrTip && (
        <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', color: phase === 'confirmed' ? '#7ee2a8' : phase === 'error' ? '#ff9fa6' : 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5 }}>{qrTip}</div>
      )}

      {!compact && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          登录后即可听 VIP 歌曲 + 同步歌单<br />扫码状态在本地轮询，登录信息安全同步
        </div>
      )}
    </div>
  );
}
