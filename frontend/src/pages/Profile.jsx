import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Music2, LogOut, Play, User as UserIcon, RefreshCw, QrCode, Globe, X } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import { listSources, getSource } from '../sources/registry';
import QrLoginView from '../components/QrLoginView';
import { CookieReader } from '../plugins/CookieReader';

// 各音源标签配色
const SOURCE_COLOR = {
  qq: '#00F5D4',
  netease: '#ff5a5f',
  kugou: '#9aa0a6',
};

function TrackRow({ track, index, active, onPlay }) {
  if (!track || !track.id) return null;
  return (
    <button onClick={() => onPlay(track)} className={`glass-row ${active ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', textAlign: 'left' }}>
      <span style={{ width: 24, textAlign: 'center', fontSize: 12, color: active ? 'var(--accent-dynamic)' : 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
        {active ? <Play size={11} fill="currentColor" /> : index + 1}
      </span>
      <div style={{ width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
        {track.cover ? <img src={track.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music2 size={16} color="var(--text-muted)" /></div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)' }}>{track.title || '未知歌曲'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist || '未知歌手'}</div>
      </div>
    </button>
  );
}

export default function Profile({ onBack }) {
  const { sources, activeSourceId, getSourceCreds, setAuth, setActiveSource, logout, fetchUserInfo } = useAuthStore();
  const { playTrackFromList, currentTrack } = usePlayerStore();

  const sources_ = listSources();

  // 当前选中的音源（用于顶部按钮高亮 + 下方登录面板）
  const [selectedSourceId, setSelectedSourceId] = useState(() => {
    const st = useAuthStore.getState();
    const first = Object.keys(st.sources).find((id) => st.sources[id].isLoggedIn);
    return first || st.activeSourceId || 'qq';
  });
  const [loginMode, setLoginMode] = useState(null); // 'qr' | null
  const [webLoginSourceId, setWebLoginSourceId] = useState(null); // 正在使用原生网页登录的音源
  const webLoginTimerRef = useRef(null);

  // 聚合所有已登录音源的歌单：{ [sourceId]: { list, loading, loaded } }
  const [allPlaylists, setAllPlaylists] = useState({});
  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const selectedSource = sources_.find((s) => s.id === selectedSourceId) || sources_[0];
  const selectedCreds = getSourceCreds(selectedSourceId);

  // 加载单个音源的歌单，结果合并进 allPlaylists
  const loadPlaylistsForSource = useCallback(async (sourceId) => {
    const c = getSourceCreds(sourceId);
    if (!c.isLoggedIn || !c.cookie || !c.uin) {
      setAllPlaylists((prev) => ({ ...prev, [sourceId]: { list: [], loading: false, loaded: true } }));
      return;
    }
    setAllPlaylists((prev) => ({ ...prev, [sourceId]: { list: [], loading: true, loaded: false } }));
    try {
      const list = await getSource(sourceId).userPlaylists(c.cookie, c.uin);
      setAllPlaylists((prev) => ({ ...prev, [sourceId]: { list: list || [], loading: false, loaded: true } }));
    } catch (e) {
      setAllPlaylists((prev) => ({ ...prev, [sourceId]: { list: [], loading: false, loaded: true } }));
    }
  }, [getSourceCreds]);

  // 首次进入刷新各已登录源的用户信息 + 歌单
  useEffect(() => {
    Object.keys(sources).forEach((id) => {
      if (sources[id].isLoggedIn) {
        fetchUserInfo(id);
        loadPlaylistsForSource(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 登录态变化时补载新增的已登录音源歌单
  const prevLoggedInRef = useRef({});
  useEffect(() => {
    const prev = prevLoggedInRef.current;
    Object.keys(sources).forEach((id) => {
      const nowLoggedIn = sources[id].isLoggedIn;
      if (nowLoggedIn && !prev[id]) {
        // 新登录的音源
        loadPlaylistsForSource(id);
      } else if (!nowLoggedIn && prev[id]) {
        // 刚登出的音源：清空其歌单
        setAllPlaylists((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      }
    });
    prevLoggedInRef.current = Object.fromEntries(
      Object.keys(sources).filter((id) => sources[id].isLoggedIn).map((id) => [id, true])
    );
  }, [sources, loadPlaylistsForSource]);

  const selectSource = (id) => {
    setSelectedSourceId(id);
    setLoginMode(null); // 切换音源时关闭登录面板
    if (getSourceCreds(id).isLoggedIn) setActiveSource(id);
  };

  // 歌单详情按歌单所属音源拉取（不依赖 selectedSourceId）
  const openPlaylistDetail = async (pl, sourceId) => {
    setLoadingDetail(true);
    setPlaylistDetail({ name: pl.name, tracks: [], sourceId });
    try {
      const creds = getSourceCreds(sourceId);
      const detail = await getSource(sourceId).playlist(pl.id, creds.cookie);
      setPlaylistDetail({ name: detail?.name || pl.name, tracks: detail?.tracks || [], sourceId });
    } catch (e) {
      setPlaylistDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const playFromPlaylist = (track) => {
    if (!track || !playlistDetail?.tracks?.length) return;
    if (playlistDetail.sourceId && playlistDetail.sourceId !== activeSourceId) {
      setActiveSource(playlistDetail.sourceId);
    }
    try { playTrackFromList(track, playlistDetail.tracks); } catch (e) { console.error('播放歌单歌曲失败', e); }
  };

  const playAll = () => {
    if (playlistDetail?.tracks?.length) {
      if (playlistDetail.sourceId && playlistDetail.sourceId !== activeSourceId) {
        setActiveSource(playlistDetail.sourceId);
      }
      playTrackFromList(playlistDetail.tracks[0], playlistDetail.tracks);
    }
  };

  const handleRefresh = () => {
    Object.keys(sources).forEach((id) => {
      if (sources[id].isLoggedIn) {
        fetchUserInfo(id);
        loadPlaylistsForSource(id);
      }
    });
  };

  const handleLoginConfirmed = (id, creds) => {
    setAuth(id, creds);
    setLoginMode(null);
    setWebLoginSourceId(null);
    setSelectedSourceId(id);
    setActiveSource(id);
  };

  // 原生网页登录（APK 下 QQ 音乐等）：打开 WebView 后轮询 Cookie
  const startWebLogin = async (s) => {
    if (!CookieReader.isAvailable()) return;
    setWebLoginSourceId(s.id);
    setLoginMode(null);
    try {
      await getSource(s.id).openLogin();
    } catch (e) {
      console.warn('打开登录 WebView', e);
    }
    if (webLoginTimerRef.current) clearInterval(webLoginTimerRef.current);
    let checks = 0;
    const MAX_CHECKS = 240; // 最多轮询 6 分钟
    webLoginTimerRef.current = setInterval(async () => {
      checks += 1;
      if (checks > MAX_CHECKS) {
        clearInterval(webLoginTimerRef.current);
        webLoginTimerRef.current = null;
        setWebLoginSourceId(null);
        return;
      }
      try {
        const c = await CookieReader.getCookiesForUrl(s.loginDomains?.[0] || 'https://y.qq.com');
        if (c.loggedIn && c.cookie) {
          clearInterval(webLoginTimerRef.current);
          webLoginTimerRef.current = null;
          setWebLoginSourceId(null);
          const parsed = getSource(s.id).parseCredentials?.(c.cookie) || { uin: c.uin, key: c.qqmusic_key };
          handleLoginConfirmed(s.id, {
            cookie: c.cookie,
            uin: parsed.uin || c.uin || '',
            key: parsed.key || c.qqmusic_key || '',
            nickname: c.login_type || s.name,
          });
        }
      } catch (e) {
        // 轮询失败忽略
      }
    }, 1500);
  };

  // 组件卸载时清理轮询
  useEffect(() => () => {
    if (webLoginTimerRef.current) clearInterval(webLoginTimerRef.current);
  }, []);

  // 统计
  const loggedInSources = sources_.filter((s) => getSourceCreds(s.id).isLoggedIn);
  const totalPlaylists = loggedInSources.reduce((sum, s) => sum + (allPlaylists[s.id]?.list?.length || 0), 0);
  const anyLoading = loggedInSources.some((s) => allPlaylists[s.id]?.loading);

  // 顶部音源按钮：未登录点击后展开登录面板，已登录点击后切换激活源
  const canWebLogin = CookieReader.isAvailable() && typeof selectedSource?.openLogin === 'function';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 30% 18%, rgba(0, 245, 212, .08) 0%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.85) 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部导航 */}
      <div className="glass-panel" style={{ padding: 'calc(10px + env(safe-area-inset-top)) 16px 10px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', flexShrink: 0 }}>
        <button onClick={onBack} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 760, flex: 1, letterSpacing: '.04em' }}>{playlistDetail ? playlistDetail.name : '我的账户'}</span>
        <button onClick={handleRefresh} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} title="刷新">
          <RefreshCw size={16} className={anyLoading ? 'spin-icon' : ''} />
        </button>
      </div>

      {/* 顶部音源按钮条：三个登录/切换按钮拼在一起 */}
      <div style={{ padding: '8px 16px', flexShrink: 0 }}>
        <div className="glass-panel" style={{ padding: 6, borderRadius: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          {sources_.map((s) => {
            const c = getSourceCreds(s.id);
            const color = SOURCE_COLOR[s.id] || '#888';
            const isSelected = selectedSourceId === s.id;
            const isActive = activeSourceId === s.id && c.isLoggedIn;
            return (
              <button
                key={s.id}
                onClick={() => selectSource(s.id)}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px 8px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: isSelected ? `${color}22` : 'transparent',
                  color: isSelected ? color : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                  boxShadow: isSelected ? `inset 0 0 0 1px ${color}55` : 'none',
                  transition: 'all .15s ease',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.isLoggedIn ? color : 'rgba(255,255,255,0.25)', boxShadow: c.isLoggedIn ? `0 0 6px ${color}` : 'none' }} />
                <span>{c.isLoggedIn ? (c.nickname || s.name) : `登录${s.name}`}</span>
                {isActive && <span style={{ fontSize: 10, opacity: 0.8 }}>·当前</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 主体：双栏，且整体可滚动（窄屏单列时） */}
      <div className="profile-shell" style={{ overflow: 'hidden' }}>
        {/* 左栏：当前音源操作 + 全部歌单 */}
        <div className="profile-left" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* 当前音源操作卡 */}
          <div className="glass-panel" style={{ borderRadius: 16, padding: 12, marginBottom: 10, border: activeSourceId === selectedSourceId && selectedCreds.isLoggedIn ? `1px solid ${SOURCE_COLOR[selectedSourceId]}55` : '1px solid rgba(255,255,255,0.06)' }}>
            {selectedCreds.isLoggedIn ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${SOURCE_COLOR[selectedSourceId]}55` }}>
                  {selectedCreds.userInfo?.avatar ? <img src={selectedCreds.userInfo.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserIcon size={20} color="var(--text-muted)" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCreds.nickname || selectedSource.name}</div>
                  <span className="source-tag" style={{ background: `${SOURCE_COLOR[selectedSourceId]}22`, color: SOURCE_COLOR[selectedSourceId], border: `1px solid ${SOURCE_COLOR[selectedSourceId]}55` }}>
                    {selectedSource.name}{activeSourceId === selectedSourceId ? ' · 当前' : ' · 已登录'}
                  </span>
                </div>
                <button onClick={() => logout(selectedSourceId)} className="glass-button" style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff9fa6', flexShrink: 0 }} title="退出">
                  <LogOut size={15} />
                </button>
              </div>
            ) : selectedSource.ready ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <UserIcon size={20} color="var(--text-muted)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedSource.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>未登录</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {canWebLogin ? (
                    <button onClick={() => startWebLogin(selectedSource)} className="glass-button-accent" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#050608' }}>
                      {webLoginSourceId === selectedSourceId ? <Loader2 size={15} className="spin-icon" /> : <Globe size={15} />}
                      {webLoginSourceId === selectedSourceId ? '登录中…' : '网页登录'}
                    </button>
                  ) : null}
                  <button onClick={() => setLoginMode(loginMode === 'qr' ? null : 'qr')} className="glass-button" style={{ flex: canWebLogin ? 1 : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    <QrCode size={15} /> {loginMode === 'qr' ? '收起' : '扫码'}
                  </button>
                </div>
                {loginMode === 'qr' && (
                  <div style={{ position: 'relative', marginTop: 4 }}>
                    <button onClick={() => setLoginMode(null)} style={{ position: 'absolute', top: -8, right: -8, zIndex: 5, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <X size={12} />
                    </button>
                    <QrLoginView sourceId={selectedSourceId} compact onConfirmed={(creds) => handleLoginConfirmed(selectedSourceId, creds)} onWebLogin={() => startWebLogin(selectedSource)} />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserIcon size={20} color="var(--text-muted)" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedSource.name}</div>
                  <span className="source-tag" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }}>开发中</span>
                </div>
              </div>
            )}
          </div>

          {/* 全部歌单（聚合所有已登录音源） */}
          {loggedInSources.length > 0 ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', padding: '8px 4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>全部歌单</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{totalPlaylists} 个 · {loggedInSources.length} 源</span>
              </div>
              <div style={{ padding: '0 2px' }}>
                {anyLoading && totalPlaylists === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 size={22} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /></div>
                ) : totalPlaylists === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>暂无歌单</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {loggedInSources.map((s) => {
                      const color = SOURCE_COLOR[s.id] || '#888';
                      const entry = allPlaylists[s.id];
                      const list = entry?.list || [];
                      if (!entry || (entry.loading && list.length === 0)) {
                        return (
                          <div key={s.id}>
                            <SourceHeader name={s.name} color={color} count={null} loading />
                            <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><Loader2 size={16} className="spin-icon" color={color} /></div>
                          </div>
                        );
                      }
                      if (list.length === 0) return null;
                      return (
                        <div key={s.id}>
                          <SourceHeader name={s.name} color={color} count={list.length} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {list.map((pl) => (
                              <button key={`${s.id}_${pl.id}`} onClick={() => openPlaylistDetail(pl, s.id)} className={`glass-row ${playlistDetail?.name === pl.name && playlistDetail?.sourceId === s.id ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, textAlign: 'left' }}>
                                <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {pl.cover ? <img src={pl.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={18} color="var(--text-secondary)" />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{pl.songCount ?? 0} 首</div>
                                </div>
                                <ChevronRight size={15} color="var(--text-muted)" />
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
              点击上方音源按钮登录，<br />登录后即可查看全部歌单
            </div>
          )}
        </div>

        {/* 右栏：歌单详情 */}
        <div className="profile-right" style={{ minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {!playlistDetail ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <Music2 size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div>从左侧选择歌单查看歌曲</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <button onClick={() => setPlaylistDetail(null)} className="glass-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: 10 }}>
                  <ArrowLeft size={14} /> 关闭
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{playlistDetail.tracks.length} 首</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px' }}>
                {loadingDetail ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Loader2 size={24} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /></div>
                  : playlistDetail.tracks.length > 0 ? (
                    <>
                      <button onClick={playAll} className="glass-button-accent" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 14px', marginBottom: 10, borderRadius: 12, fontSize: 13 }}>
                        <Play size={16} fill="currentColor" /> 播放全部 ({playlistDetail.tracks.length})
                      </button>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {playlistDetail.tracks.map((t, i) => <TrackRow key={t.id || i} track={t} index={i} active={currentTrack?.id === t.id} onPlay={playFromPlaylist} />)}
                      </div>
                    </>
                  ) : <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>歌单为空</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 音源分组标题
function SourceHeader({ name, color, count, loading }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 6px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '.06em' }}>{name}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{loading ? '加载中…' : `${count ?? 0} 个`}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}
