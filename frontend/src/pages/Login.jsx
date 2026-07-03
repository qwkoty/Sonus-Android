import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Loader2, Music, ArrowLeft, Cookie, ChevronDown, ChevronUp } from 'lucide-react';
import { music } from '../api/music';
import { useAuthStore } from '../store/useAuthStore';
import { qqQrPoll } from '../utils/qqLogin';

// 登录流程：
// 主模式：自动轮询扫码登录（前端 JSONP 请求 ptqrlogin，绕过服务器 IP 风控）
//   - 注：若 QQ 网关普遍返回 403（不响应 JSONP），轮询会一直超时；
//     此时用户切换到"Cookie 导入"模式即可
// 兜底模式：从浏览器复制 QQ 音乐已登录的 Cookie 粘贴登录
export default function Login({ onBack }) {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [mode, setMode] = useState('qr'); // 'qr' | 'cookie'

  // QR 模式状态
  const [qrcode, setQrcode] = useState('');
  // phase: loading | waiting | scanned | logging | expired | error
  const [phase, setPhase] = useState('loading');
  const [tip, setTip] = useState('正在加载二维码…');
  const [errorMsg, setErrorMsg] = useState('');
  const qrsigRef = useRef('');
  const loginSigRef = useRef(''); // 关键：xlogin 返回的 login_sig，ptqrlogin 必须带
  const stopPollRef = useRef(null);

  // Cookie 模式状态
  const [cookieInput, setCookieInput] = useState('');
  const [cookieLogging, setCookieLogging] = useState(false);
  const [cookieError, setCookieError] = useState('');

  const fetchQr = async () => {
    if (stopPollRef.current) { stopPollRef.current(); stopPollRef.current = null; }
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
    stopPollRef.current = qqQrPoll(qrsig, loginSigRef.current, {
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
        // 不阻塞用户：JSONP 在某些网络环境会被风控，不显示错误，只引导
        // 用户用 Cookie 模式登录
        if (msg && !errorMsg) {
          setErrorMsg(msg);
        }
      },
    });
  };

  useEffect(() => {
    if (mode === 'qr') {
      fetchQr();
    } else {
      if (stopPollRef.current) { stopPollRef.current(); stopPollRef.current = null; }
    }
    return () => {
      if (stopPollRef.current) stopPollRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleCookieLogin = async () => {
    if (!cookieInput.trim()) {
      setCookieError('请粘贴 Cookie');
      return;
    }
    setCookieLogging(true);
    setCookieError('');
    try {
      // 直接用 cookie 调用户信息接口验证
      const m = cookieInput.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/);
      if (!m) {
        setCookieError('Cookie 中未找到 uin，请确认是已登录 y.qq.com 的 Cookie');
        setCookieLogging(false);
        return;
      }
      const uin = m[1];
      const info = await music.userInfo(cookieInput, uin);
      if (!info || !info.uin) {
        setCookieError('Cookie 无效或已过期');
        setCookieLogging(false);
        return;
      }
      // 提取关键 cookie 值
      const key = (cookieInput.match(/(?:^|;\s*)(qqmusic_key|p_skey|skey)=([^;]+)/) || [])[2] || '';
      setAuth({
        cookie: cookieInput,
        uin: String(uin),
        key,
        nickname: info.nickname || 'QQ音乐用户',
      });
      // setAuth 触发 fetchUserInfo + App 自动切到播放器
    } catch (e) {
      setCookieError('Cookie 登录失败：' + (e.message || ''));
    } finally {
      setCookieLogging(false);
    }
  };

  const isBusy = phase === 'loading' || phase === 'logging';

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

      {/* 主内容卡片 */}
      {mode === 'qr' ? (
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
                    filter: phase === 'logging' ? 'blur(6px) opacity(0.4)' : phase === 'scanned' ? 'brightness(0.85)' : 'none',
                    transition: 'filter 0.3s ease',
                  }}
                />
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
                {phase === 'logging' && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-dynamic)' }} />
                  </div>
                )}
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
            marginTop: 20, fontSize: 15, fontWeight: 600, textAlign: 'center',
            color: phase === 'scanned' ? '#4ADE80' : phase === 'logging' ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
            zIndex: 1, transition: 'color 0.3s ease', minHeight: 22,
          }}>
            {tip}
          </div>

          {/* 风控提示：扫码状态检测被风控时显示 */}
          {errorMsg && phase === 'waiting' && (
            <div className="glass-panel" style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 12, zIndex: 1,
              maxWidth: 320, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, color: '#FBBF24', marginBottom: 4 }}>扫码状态检测异常</div>
              <div>可能是 QQ 接口被风控。请先扫码并确认登录，然后切换下方"Cookie 登录"完成最后一步。</div>
            </div>
          )}

          {/* 错误提示（非风控） */}
          {errorMsg && phase !== 'waiting' && phase !== 'expired' && (
            <div style={{
              marginTop: 8, fontSize: 12, color: '#F87171', textAlign: 'center', zIndex: 1,
              maxWidth: 280, lineHeight: 1.5,
            }}>
              {errorMsg}
            </div>
          )}

          {/* 操作按钮区 */}
          <div style={{ marginTop: 16, display: 'flex', gap: 10, zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            {qrcode && !isBusy && (
              <button onClick={fetchQr} className="glass-button" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10,
                fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
              }}>
                <RefreshCw size={13} /> 刷新二维码
              </button>
            )}
          </div>
        </>
      ) : (
        /* Cookie 登录模式 */
        <div className="glass-panel-strong" style={{
          position: 'relative', zIndex: 1,
          padding: 20, borderRadius: 20, maxWidth: 360, width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Cookie size={18} color="var(--accent-dynamic)" />
            <span style={{ fontSize: 15, fontWeight: 700 }}>Cookie 登录</span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
            当扫码登录失效时使用此方式。步骤：
            <ol style={{ marginTop: 6, paddingLeft: 20 }}>
              <li>在浏览器打开 <a href="https://y.qq.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-dynamic)' }}>y.qq.com</a> 并登录</li>
              <li>按 F12 → Application → Cookies → 复制全部</li>
              <li>粘贴到下方输入框</li>
            </ol>
          </div>

          <textarea
            value={cookieInput}
            onChange={(e) => { setCookieInput(e.target.value); setCookieError(''); }}
            placeholder="uin=o1234567890; qqmusic_key=...; p_skey=..."
            rows={4}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)',
              color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace',
              resize: 'vertical', minHeight: 80,
            }}
          />

          {cookieError && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#F87171' }}>
              {cookieError}
            </div>
          )}

          <button onClick={handleCookieLogin} disabled={cookieLogging} className="glass-button-accent" style={{
            marginTop: 12, width: '100%', padding: '12px', borderRadius: 12,
            fontSize: 14, fontWeight: 700, color: '#0A0A0A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: cookieLogging ? 0.6 : 1,
          }}>
            {cookieLogging
              ? <><Loader2 size={14} className="spin-icon" /> 登录中…</>
              : <>登录</>
            }
          </button>
        </div>
      )}

      {/* 模式切换 */}
      <button onClick={() => setMode(mode === 'qr' ? 'cookie' : 'qr')} className="glass-button" style={{
        marginTop: 18, padding: '8px 16px', borderRadius: 10,
        fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        zIndex: 1,
      }}>
        {mode === 'qr' ? (
          <><Cookie size={13} /> Cookie 登录（扫码失败时使用）<ChevronDown size={12} /></>
        ) : (
          <><ChevronUp size={12} /> 返回扫码登录</>
        )}
      </button>

      {/* 底部提示 */}
      <div style={{
        marginTop: 24,
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', zIndex: 1,
        padding: '0 24px 20px', maxWidth: 400,
      }}>
        请使用已安装 QQ 的手机扫码并确认登录 · 仅用于解锁 VIP 与同步歌单
      </div>
    </div>
  );
}
