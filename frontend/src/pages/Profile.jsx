import { useState, useEffect, useRef } from 'react';
import {
  User, LogOut, Moon, Settings, HelpCircle,
  Plus, Trash2, Play, Music, X, Check, RefreshCw, Loader2,
  Download, Heart,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';

export default function Profile() {
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState(null);

  // 扫码登录状态
  const [loginPlatform, setLoginPlatform] = useState(null); // 'netease' | 'qq' | null
  const [qrImg, setQrImg] = useState('');
  const [loginMsg, setLoginMsg] = useState('');
  const [loginCode, setLoginCode] = useState(0); // 0 初始 801 等待扫码 802 已扫码 803 成功
  const [loginLoading, setLoginLoading] = useState(false);
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const pollRef = useRef(null);
  const unikeyRef = useRef('');
  const qrsigRef = useRef('');

  const {
    playlists, createPlaylist, deletePlaylist, removeFromPlaylist,
    playPlaylist, playTrack, importPlaylist,
    neteaseCookie, neteaseUser, qqCookie, qqUser,
    setNeteaseAuth, clearNeteaseAuth, setQQAuth, clearQQAuth,
    setPlaylist, setError,
  } = usePlayerStore();

  const handleCreate = () => {
    if (!newName.trim()) return;
    createPlaylist(newName.trim());
    setNewName('');
    setShowCreate(false);
  };

  // 清理轮询
  useEffect(() => () => stopPoll(), []);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // 开始网易云扫码登录
  const startNeteaseLogin = async () => {
    setLoginPlatform('netease');
    setLoginLoading(true);
    setLoginMsg('生成二维码中…');
    setLoginCode(0);
    setQrImg('');
    stopPoll();
    try {
      const uniRes = await music.neteaseUnikey();
      const unikey = uniRes?.data?.unikey;
      if (!unikey) throw new Error('获取 unikey 失败');
      unikeyRef.current = unikey;
      const qrRes = await music.neteaseQrcode(unikey);
      setQrImg(qrRes?.data?.qrimg || '');
      setLoginMsg('请用网易云音乐 App 扫码');
      setLoginCode(801);
      // 开始轮询
      pollRef.current = setInterval(() => pollNetease(), 2000);
    } catch (e) {
      setLoginMsg('二维码生成失败：' + e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const pollNetease = async () => {
    try {
      const res = await music.neteaseCheck(unikeyRef.current);
      const code = res?.data?.code;
      setLoginCode(code);
      if (code === 801) setLoginMsg('等待扫码…');
      else if (code === 802) setLoginMsg('已扫码，请在手机确认');
      else if (code === 803) {
        setLoginMsg('登录成功！');
        const cookie = res.data.cookie;
        const user = res.data.user;
        setNeteaseAuth(cookie, user);
        stopPoll();
        // 立即关闭弹窗，歌单同步在后台进行
        setTimeout(() => { setLoginPlatform(null); setQrImg(''); }, 800);
        if (user?.userId) {
          fetchNeteasePlaylists(cookie, user.userId);
          syncNeteasePlaylists(cookie, user.userId, user);
        }
      } else if (code === 800) {
        setLoginMsg('二维码已过期，请刷新');
      }
    } catch (e) { /* 超时或网络错误，静默忽略，下次轮询继续 */ }
  };

  const fetchNeteasePlaylists = async (cookie, uid) => {
    setLoadingRemote(true);
    try {
      const res = await music.neteasePlaylists(cookie, uid);
      setRemotePlaylists(res?.data?.list || []);
    } catch (e) {} finally { setLoadingRemote(false); }
  };

  // 自动同步网易云账号所有歌单到本地（含歌曲，最多取每个歌单前 300 首）
  const syncNeteasePlaylists = async (cookie, uid, user) => {
    try {
      const res = await music.neteasePlaylists(cookie, uid);
      const list = res?.data?.list || [];
      // 逐个拉取歌单详情并导入本地（"我喜欢的音乐"标记特殊）
      for (const pl of list.slice(0, 20)) {
        try {
          const detail = await music.playlist(pl.id, 'netease');
          const tracks = detail?.data?.tracks || [];
          if (tracks.length) {
            const name = pl.id === list[0].id ? `我喜欢 · ${user?.nickname || '网易云'}` : pl.name;
            importPlaylist(name, tracks, pl.cover);
          }
        } catch (e) { /* 单个歌单失败跳过 */ }
      }
      setError('已同步网易云歌单到本地');
    } catch (e) {
      setError('同步歌单失败');
    }
  };

  // 开始 QQ 扫码登录
  const startQQLogin = async () => {
    setLoginPlatform('qq');
    setLoginLoading(true);
    setLoginMsg('生成二维码中…');
    setLoginCode(0);
    setQrImg('');
    stopPoll();
    try {
      const res = await music.qqQrcode();
      const qrsig = res?.data?.qrsig;
      if (!qrsig) throw new Error('获取 qrsig 失败');
      qrsigRef.current = qrsig;
      setQrImg(res.data.qrimg || '');
      setLoginMsg('请用 QQ 音乐 App 扫码');
      setLoginCode(801);
      pollRef.current = setInterval(() => pollQQ(), 2000);
    } catch (e) {
      setLoginMsg('二维码生成失败：' + e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const pollQQ = async () => {
    try {
      const res = await music.qqCheck(qrsigRef.current);
      const code = res?.data?.code;
      setLoginCode(code);
      if (code === 801) setLoginMsg('等待扫码…');
      else if (code === 802) setLoginMsg(res?.data?.msg?.includes('正在登录') ? '正在登录，请稍候…' : '已扫码，请在手机确认');
      else if (code === 803 || res?.data?.cookie) {
        setLoginMsg('登录成功！');
        const cookieStr = res.data.cookie || '';
        const uin = res.data.uin || '';
        const key = res.data.key || '';
        const user = res.data.user || null;
        setQQAuth({ uin, key, raw: cookieStr }, user);
        stopPoll();
        // 立即关闭弹窗，歌单同步在后台进行
        setTimeout(() => { setLoginPlatform(null); setQrImg(''); }, 800);
        if (uin && key) {
          fetchQQPlaylists(uin, key);
          syncQQPlaylists(uin, key, user);
        }
      } else if (code === 800) {
        setLoginMsg('二维码已过期，请刷新');
      }
    } catch (e) { /* 超时或网络错误，静默忽略，下次轮询继续 */ }
  };

  const fetchQQPlaylists = async (uin, key) => {
    setLoadingRemote(true);
    try {
      const res = await music.qqPlaylists(uin, key);
      setRemotePlaylists(res?.data?.list || []);
    } catch (e) {} finally { setLoadingRemote(false); }
  };

  // 自动同步 QQ 账号所有歌单到本地
  const syncQQPlaylists = async (uin, key, user) => {
    try {
      const res = await music.qqPlaylists(uin, key);
      const list = res?.data?.list || [];
      for (const pl of list.slice(0, 20)) {
        try {
          const detail = await music.playlist(pl.id, 'qq');
          const tracks = detail?.data?.tracks || [];
          if (tracks.length) {
            const name = pl.id === list[0].id ? `我喜欢 · ${user?.nickname || 'QQ'}` : pl.name;
            importPlaylist(name, tracks, pl.cover);
          }
        } catch (e) { /* 单个歌单失败跳过 */ }
      }
      setError('已同步QQ音乐歌单到本地');
    } catch (e) {
      setError('同步歌单失败');
    }
  };

  const closeLogin = () => {
    stopPoll();
    setLoginPlatform(null);
    setQrImg('');
    setLoginMsg('');
    setLoginCode(0);
  };

  const logoutNetease = () => {
    clearNeteaseAuth();
    setRemotePlaylists([]);
  };
  const logoutQQ = () => {
    clearQQAuth();
    setRemotePlaylists([]);
  };

  // 加载云歌单歌曲到播放列表
  const loadRemotePlaylist = async (platform, id) => {
    try {
      setLoadingRemote(true);
      const res = await music.playlist(id, platform);
      const tracks = res?.data?.tracks || [];
      if (tracks.length) {
        setPlaylist(tracks);
        playTrack(tracks[0]);
        setError(`已加载歌单「${res.data.name}」共 ${tracks.length} 首`);
      } else {
        setError('歌单为空');
      }
    } catch (e) {
      setError('加载歌单失败');
    } finally { setLoadingRemote(false); }
  };

  // 一键同步"我喜欢"到播放列表
  const [syncingLiked, setSyncingLiked] = useState(false);
  const syncLiked = async () => {
    setSyncingLiked(true);
    try {
      let res;
      if (isLoggedInNetease) res = await music.neteaseLikedSongs(neteaseCookie, neteaseUser?.userId);
      else if (isLoggedInQQ) res = await music.qqLikedSongs(qqCookie.uin, qqCookie.key);
      const tracks = res?.data?.tracks || [];
      if (tracks.length) {
        setPlaylist(tracks);
        playTrack(tracks[0]);
        setError(`已同步「我喜欢」共 ${tracks.length} 首`);
      } else {
        setError('我喜欢列表为空');
      }
    } catch (e) {
      setError('同步我喜欢失败');
    } finally { setSyncingLiked(false); }
  };

  // 导入云歌单到本地（持久化）
  const [importingId, setImportingId] = useState(null);
  const importRemotePlaylist = async (platform, pl) => {
    setImportingId(pl.id);
    try {
      const res = await music.playlist(pl.id, platform);
      const tracks = res?.data?.tracks || [];
      importPlaylist(pl.name, tracks, pl.cover);
      setError(`已导入「${pl.name}」到本地，共 ${tracks.length} 首`);
    } catch (e) {
      setError('导入失败');
    } finally { setImportingId(null); }
  };

  const isLoggedInNetease = !!neteaseCookie;
  const isLoggedInQQ = !!qqCookie?.raw;

  return (
    <div style={{ padding: 'calc(12px + env(safe-area-inset-top)) 20px 40px', overflowY: 'auto', height: '100%' }}>
      {/* 标题区域 */}
      <div style={{ paddingLeft: 52, marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>我的</h1>
      </div>

      {/* 用户卡片：扫码登录 */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 20,
        padding: 24,
        textAlign: 'center',
        marginBottom: 24,
        border: '1px solid var(--border)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--surface)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px', overflow: 'hidden',
        }}>
          {neteaseUser?.avatar || qqUser?.avatar
            ? <img src={neteaseUser?.avatar || qqUser?.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <User size={32} color="var(--text-secondary)" />
          }
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {neteaseUser?.nickname || qqUser?.nickname || '访客'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {isLoggedInNetease || isLoggedInQQ ? '已登录' : '扫码登录以同步你的歌单'}
        </div>

        {/* 登录按钮：未登录时显示，已登录显示退出 */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {!isLoggedInNetease ? (
            <button
              onClick={startNeteaseLogin}
              disabled={loginLoading}
              style={loginBtnStyle('#E1306C', loginLoading)}
            >
              {loginLoading && loginPlatform === 'netease' ? <Loader2 size={14} className="spin" /> : null}
              网易云扫码
            </button>
          ) : (
            <button onClick={logoutNetease} style={logoutBtnStyle}>
              <LogOut size={14} /> 退出网易云
            </button>
          )}
          {!isLoggedInQQ ? (
            <button
              onClick={startQQLogin}
              disabled={loginLoading}
              style={loginBtnStyle('#31C27C', loginLoading)}
            >
              {loginLoading && loginPlatform === 'qq' ? <Loader2 size={14} className="spin" /> : null}
              QQ音乐扫码
            </button>
          ) : (
            <button onClick={logoutQQ} style={logoutBtnStyle}>
              <LogOut size={14} /> 退出QQ
            </button>
          )}
        </div>
      </div>

      {/* 云歌单（登录后显示） */}
      {(isLoggedInNetease || isLoggedInQQ) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>
              云歌单 {neteaseUser ? '·网易云' : qqUser ? '·QQ音乐' : ''}
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={syncLiked}
                disabled={syncingLiked}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8,
                  background: syncingLiked ? 'var(--surface)' : 'var(--accent-dynamic, #4FC3F7)',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  border: 'none', cursor: syncingLiked ? 'not-allowed' : 'pointer',
                  opacity: syncingLiked ? 0.6 : 1,
                }}
              >
                {syncingLiked ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Heart size={13} fill="currentColor" />}
                同步我喜欢
              </button>
              <button
                onClick={() => {
                  if (isLoggedInNetease) fetchNeteasePlaylists(neteaseCookie, neteaseUser?.userId);
                  else if (isLoggedInQQ) fetchQQPlaylists(qqCookie.uin, qqCookie.key);
                }}
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' }}
                aria-label="刷新"
              >
                <RefreshCw size={14} color="var(--text-secondary)" />
              </button>
            </div>
          </div>
          {loadingRemote ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> 加载中…
            </div>
          ) : remotePlaylists.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>暂无云歌单</div>
          ) : remotePlaylists.map((pl) => (
            <div key={pl.id} style={{
              background: 'var(--bg-secondary)', borderRadius: 14, padding: '12px 14px',
              marginBottom: 10, border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <img src={pl.cover} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', cursor: 'pointer' }} onClick={() => loadRemotePlaylist(isLoggedInNetease ? 'netease' : 'qq', pl.id)} />
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => loadRemotePlaylist(isLoggedInNetease ? 'netease' : 'qq', pl.id)}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{pl.trackCount} 首 {pl.creator ? `· ${pl.creator}` : ''}</div>
              </div>
              <button
                onClick={() => importRemotePlaylist(isLoggedInNetease ? 'netease' : 'qq', pl)}
                disabled={importingId === pl.id}
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', opacity: importingId === pl.id ? 0.5 : 1 }}
                title="导入到本地歌单"
              >
                {importingId === pl.id
                  ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} color="var(--text-secondary)" />
                  : <Download size={14} color="var(--text-secondary)" />}
              </button>
              <button
                onClick={() => loadRemotePlaylist(isLoggedInNetease ? 'netease' : 'qq', pl.id)}
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' }}
                title="播放"
              >
                <Play size={14} fill="currentColor" color="var(--text-secondary)" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 本地歌单 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>我的歌单</h2>
          <button onClick={() => setShowCreate(!showCreate)} style={newBtnStyle}>
            <Plus size={14} /> 新建
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
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: 'var(--text-primary)' }}
            />
            <button onClick={handleCreate} style={{ padding: '10px 18px', borderRadius: 10, background: '#fff', color: '#0A0A0A', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>创建</button>
          </div>
        )}

        {playlists.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>还没有歌单，点击新建一个</div>
        ) : playlists.map((pl) => (
          <div key={pl.id} style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: '14px 16px', marginBottom: 10, border: '1px solid var(--border)' }}>
            <div onClick={() => setActivePlaylist(activePlaylist === pl.id ? null : pl.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  <Music size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{pl.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{pl.tracks.length} 首声波</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pl.tracks.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); playPlaylist(pl.id); }} style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', color: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <Play size={14} fill="currentColor" />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); setActivePlaylist(null); }} style={{ color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {activePlaylist === pl.id && pl.tracks.length > 0 && (
              <div className="animate-slideUp" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {pl.tracks.map((track, i) => (
                  <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < pl.tracks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <img src={track.cover} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }} onClick={() => playTrack(track)}>
                      <div style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{track.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{track.artist}</div>
                    </div>
                    <button onClick={() => removeFromPlaylist(pl.id, track.id)} style={{ color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none' }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 菜单 */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {[
          { icon: Moon, label: '深色模式', value: '始终开启' },
          { icon: Settings, label: '偏好设置', value: '' },
          { icon: HelpCircle, label: '关于 Sonus', value: 'v1.0.0' },
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: i < 2 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <item.icon size={20} color="var(--text-secondary)" />
            <div style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{item.label}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* 扫码登录弹窗 */}
      {loginPlatform && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={closeLogin}>
          <div style={{
            background: 'var(--glass-2, rgba(20,20,24,0.9))',
            borderRadius: 28, padding: 0,
            width: 'min(92vw, 340px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            {/* 头部：平台标识 + 关闭 */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: loginPlatform === 'netease'
                    ? 'linear-gradient(135deg, #E1306C, #F56040)'
                    : 'linear-gradient(135deg, #31C27C, #1ED760)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 800,
                }}>
                  {loginPlatform === 'netease' ? '网' : 'Q'}
                </div>
                <span style={{ fontSize: 16, fontWeight: 700 }}>
                  {loginPlatform === 'netease' ? '网易云音乐' : 'QQ音乐'}登录
                </span>
              </div>
              <button onClick={closeLogin} style={{
                width: 30, height: 30, borderRadius: 10,
                background: 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: 'none', color: 'var(--text-secondary)',
                transition: 'background 0.2s',
              }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}>
                <X size={16} />
              </button>
            </div>

            {/* 二维码区 */}
            <div style={{ padding: '20px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                width: 200, height: 200, borderRadius: 18,
                background: '#fff', padding: 10,
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                {qrImg ? (
                  <img src={qrImg} alt="二维码" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}>
                    <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} color="#999" />
                  </div>
                )}
                {loginCode === 800 && (
                  <button onClick={loginPlatform === 'netease' ? startNeteaseLogin : startQQLogin}
                    style={{
                      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)',
                      color: '#fff', border: 'none', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                      fontSize: 13, fontWeight: 600, borderRadius: 18,
                    }}>
                    <RefreshCw size={22} />
                    二维码已过期
                    <span style={{ fontSize: 11, opacity: 0.7 }}>点击刷新</span>
                  </button>
                )}
                {loginCode === 803 && (
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(31,193,124,0.85)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                    color: '#fff', borderRadius: 18,
                  }}>
                    <Check size={36} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>登录成功</span>
                  </div>
                )}
              </div>

              {/* 状态文字 */}
              <div style={{
                marginTop: 16, fontSize: 14, fontWeight: 600, minHeight: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                color: loginCode === 803 ? '#31C27C' : loginCode === 800 ? '#F87171' : 'var(--text-primary)',
              }}>
                {(loginCode === 801 || loginCode === 802 || loginCode === 0) && loginMsg && !loginMsg.includes('失败') && (
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                )}
                {loginMsg || '生成二维码中…'}
              </div>

              {/* 提示 */}
              <div style={{
                marginTop: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5,
              }}>
                请使用{loginPlatform === 'netease' ? '网易云音乐' : 'QQ音乐'}App<br />扫描上方二维码完成登录
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const loginBtnStyle = (color, disabled) => ({
  padding: '10px 20px', borderRadius: 24,
  background: disabled ? 'var(--surface)' : color,
  color: disabled ? 'var(--text-muted)' : '#fff',
  fontWeight: 700, fontSize: 13,
  display: 'flex', alignItems: 'center', gap: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: 'none', opacity: disabled ? 0.6 : 1,
});

const logoutBtnStyle = {
  padding: '10px 20px', borderRadius: 24,
  background: 'var(--surface)', color: 'var(--text-secondary)',
  fontWeight: 700, fontSize: 13,
  display: 'flex', alignItems: 'center', gap: 6,
  cursor: 'pointer', border: 'none',
};

const newBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 13, color: 'var(--text-primary)', fontWeight: 600,
  padding: '6px 12px', borderRadius: 10, background: 'var(--surface)',
  cursor: 'pointer', border: 'none',
};
