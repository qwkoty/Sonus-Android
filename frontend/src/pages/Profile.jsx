import { useState, useEffect } from 'react';
import {
  User, Link as LinkIcon, LogOut, Moon, Settings, HelpCircle,
  Plus, Trash2, Play, Music, X, QrCode, AlertCircle
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { qqmusicApi } from '../api/qqmusic';

export default function Profile() {
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [qrPolling, setQrPolling] = useState(false);
  const [qrError, setQrError] = useState('');
  const [pollTimer, setPollTimer] = useState(null);

  const {
    playlists, createPlaylist, deletePlaylist, removeFromPlaylist,
    playPlaylist, playTrack, qqAuth, connectedPlatform,
    setQQAuth, logoutQQ,
  } = usePlayerStore();

  const isQQConnected = connectedPlatform === 'qq' && qqAuth;

  const handleCreate = () => {
    if (!newName.trim()) return;
    createPlaylist(newName.trim());
    setNewName('');
    setShowCreate(false);
  };

  // QQ 音乐扫码登录
  const startQQLogin = async () => {
    setQrError('');
    setQrData(null);
    try {
      const res = await qqmusicApi.qrcode();
      if (res.error) {
        setQrError(res.error + (res.message ? ` (${res.message})` : ''));
        return;
      }
      if (res.qrurl) {
        setQrData({ qrurl: res.qrurl, authCode: res.auth_code });
        startPolling(res.auth_code);
      } else {
        setQrError('无法获取二维码，请检查后端是否配置了 APP_ID');
      }
    } catch (err) {
      setQrError('获取二维码失败: ' + (err.message || '未知错误'));
    }
  };

  const startPolling = (authCode) => {
    setQrPolling(true);
    let attempts = 0;
    const maxAttempts = 60;

    const timer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(timer);
        setQrPolling(false);
        setQrError('二维码已过期，请重新获取');
        return;
      }

      try {
        const poll = await qqmusicApi.poll(authCode);
        if (poll.status === 'authorized') {
          clearInterval(timer);
          setQrPolling(false);
          // 获取 token
          try {
            const tokenRes = await qqmusicApi.token(poll.code);
            const token = tokenRes.data?.access_token || tokenRes.access_token;
            const refreshToken = tokenRes.data?.refresh_token || tokenRes.refresh_token;
            if (token) {
              // 获取用户信息
              let userInfo = {};
              try {
                const info = await qqmusicApi.userinfo(token);
                userInfo = info.data || info;
              } catch (e) {
                console.log('获取用户信息失败', e);
              }
              setQQAuth({ token, refreshToken, userInfo });
              setQrData(null);
            }
          } catch (e) {
            setQrError('获取 Token 失败: ' + (e.message || ''));
          }
          return;
        }
        if (poll.status === 'expired') {
          clearInterval(timer);
          setQrPolling(false);
          setQrError('二维码已过期');
        }
      } catch (err) {
        // 轮询中出错，继续
      }
    }, 3000);

    setPollTimer(timer);
  };

  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  const cancelQR = () => {
    if (pollTimer) clearInterval(pollTimer);
    setQrPolling(false);
    setQrData(null);
    setQrError('');
  };

  return (
    <div style={{ padding: 'calc(12px + env(safe-area-inset-top)) 20px 40px' }}>
      {/* 标题区域：左侧留空避让导航按钮 */}
      <div style={{ paddingLeft: 52, marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>我的</h1>
      </div>

      {/* User Card */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 20,
        padding: 24,
        textAlign: 'center',
        marginBottom: 24,
        border: '1px solid var(--border)',
      }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: isQQConnected ? '#fff' : '#333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 14px',
          color: isQQConnected ? '#0A0A0A' : '#fff',
        }}>
          <User size={32} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {isQQConnected && qqAuth?.userInfo?.nickname
            ? qqAuth.userInfo.nickname
            : isQQConnected ? 'QQ 音乐用户' : '访客'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {isQQConnected ? '已连接 QQ 音乐' : '尚未连接声波源'}
        </div>

        {!isQQConnected ? (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={startQQLogin}
              style={{
                padding: '10px 28px',
                borderRadius: 24,
                background: '#fff',
                color: '#0A0A0A',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <QrCode size={16} />
                QQ 扫码登录
              </span>
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              登录后仅搜索 QQ 音乐内容
            </div>

            {/* 二维码展示 */}
            {qrData && (
              <div className="animate-scaleIn" style={{
                marginTop: 16,
                padding: 16,
                background: '#fff',
                borderRadius: 16,
                display: 'inline-block',
              }}>
                <img
                  src={qrData.qrurl}
                  alt="QQ 登录二维码"
                  style={{ width: 180, height: 180, display: 'block' }}
                />
                <div style={{ fontSize: 12, color: '#0A0A0A', marginTop: 8, fontWeight: 600 }}>
                  请使用 QQ 音乐 App 扫码
                </div>
                <button
                  onClick={cancelQR}
                  style={{ marginTop: 8, fontSize: 11, color: '#666' }}
                >
                  取消
                </button>
              </div>
            )}

            {qrError && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}>
                <AlertCircle size={14} />
                {qrError}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={logoutQQ}
            style={{
              marginTop: 16,
              padding: '10px 28px',
              borderRadius: 24,
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={16} />
              退出登录
            </span>
          </button>
        )}
      </div>

      {/* 歌单系统 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>我的歌单</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              color: 'var(--text-primary)',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 10,
              background: 'var(--surface)',
            }}
          >
            <Plus size={14} />
            新建
          </button>
        </div>

        {showCreate && (
          <div className="animate-slideUp" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="歌单名称"
              autoFocus
              style={{
                flex: 1,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 14,
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={handleCreate}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                background: '#fff',
                color: '#0A0A0A',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              创建
            </button>
          </div>
        )}

        {playlists.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            还没有歌单，点击右上角新建一个
          </div>
        )}

        {playlists.map((pl) => (
          <div
            key={pl.id}
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: 14,
              padding: '14px 16px',
              marginBottom: 10,
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            <div
              onClick={() => setActivePlaylist(activePlaylist === pl.id ? null : pl.id)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                }}>
                  <Music size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{pl.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {pl.tracks.length} 首声波
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pl.tracks.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); playPlaylist(pl.id); }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: '#fff',
                      color: '#0A0A0A',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Play size={14} fill="currentColor" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); setActivePlaylist(null); }}
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {activePlaylist === pl.id && pl.tracks.length > 0 && (
              <div className="animate-slideUp" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {pl.tracks.map((track, i) => (
                  <div
                    key={track.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: i < pl.tracks.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <img src={track.cover} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }} onClick={() => playTrack(track)}>
                      <div style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{track.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{track.artist}</div>
                    </div>
                    <button onClick={() => removeFromPlaylist(pl.id, track.id)} style={{ color: 'var(--text-muted)' }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Menu */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {[
          { icon: Moon, label: '深色模式', value: '始终开启' },
          { icon: Settings, label: '偏好设置', value: '' },
          { icon: HelpCircle, label: '关于 Sonus', value: 'v1.0.0' },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '16px 20px',
            borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
          }}>
            <item.icon size={20} color="var(--text-secondary)" />
            <div style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{item.label}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
