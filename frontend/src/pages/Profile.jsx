import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Music2, LogOut, Play, User as UserIcon, RefreshCw, QrCode } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import { listSources, getSource } from '../sources/registry';
import QrLoginView from '../components/QrLoginView';

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

  const [selectedSourceId, setSelectedSourceId] = useState(() => {
    const st = useAuthStore.getState();
    const first = Object.keys(st.sources).find((id) => st.sources[id].isLoggedIn);
    return first || st.activeSourceId || 'qq';
  });
  const [expandedSourceId, setExpandedSourceId] = useState(null); // 内嵌扫码展开的音源

  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const selectedCreds = getSourceCreds(selectedSourceId);

  const loadPlaylists = useCallback(async (sourceId) => {
    const c = getSourceCreds(sourceId);
    if (!c.isLoggedIn || !c.cookie || !c.uin) { setPlaylists([]); return; }
    setLoadingPlaylists(true);
    try {
      const list = await getSource(sourceId).userPlaylists(c.cookie, c.uin);
      setPlaylists(list || []);
    } catch (e) {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }, [getSourceCreds]);

  // 首次进入刷新各已登录源的用户信息
  useEffect(() => {
    Object.keys(sources).forEach((id) => { if (sources[id].isLoggedIn) fetchUserInfo(id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中源变化或登录态变化时重载歌单
  useEffect(() => {
    if (selectedCreds.isLoggedIn) loadPlaylists(selectedSourceId);
    else setPlaylists([]);
  }, [selectedSourceId, selectedCreds.isLoggedIn, loadPlaylists]);

  const selectSource = (id) => {
    setSelectedSourceId(id);
    setPlaylistDetail(null);
    if (getSourceCreds(id).isLoggedIn) setActiveSource(id);
  };

  const openPlaylistDetail = async (pl) => {
    setLoadingDetail(true);
    setPlaylistDetail({ name: pl.name, tracks: [] });
    try {
      const creds = getSourceCreds(selectedSourceId);
      const detail = await getSource(selectedSourceId).playlist(pl.id, creds.cookie);
      setPlaylistDetail({ name: detail?.name || pl.name, tracks: detail?.tracks || [] });
    } catch (e) {
      setPlaylistDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const playFromPlaylist = (track) => {
    if (!track || !playlistDetail?.tracks?.length) return;
    try { playTrackFromList(track, playlistDetail.tracks); } catch (e) { console.error('播放歌单歌曲失败', e); }
  };

  const playAll = () => {
    if (playlistDetail?.tracks?.length) playTrackFromList(playlistDetail.tracks[0], playlistDetail.tracks);
  };

  const handleRefresh = () => {
    Object.keys(sources).forEach((id) => { if (sources[id].isLoggedIn) fetchUserInfo(id); });
    loadPlaylists(selectedSourceId);
  };

  const handleLoginConfirmed = (id, creds) => {
    setAuth(id, creds);
    setExpandedSourceId(null);
    setSelectedSourceId(id);
    setActiveSource(id);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 30% 18%, rgba(0, 245, 212, .08) 0%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.85) 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部导航 */}
      <div className="glass-panel" style={{ padding: 'calc(10px + env(safe-area-inset-top)) 16px 10px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', flexShrink: 0 }}>
        <button onClick={onBack} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 760, flex: 1, letterSpacing: '.04em' }}>{playlistDetail ? playlistDetail.name : '我的账户'}</span>
        <button onClick={handleRefresh} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} title="刷新">
          <RefreshCw size={16} className={loadingPlaylists ? 'spin-icon' : ''} />
        </button>
      </div>

      {/* 双栏内容（窄屏由 CSS 折叠为单栏） */}
      <div className="profile-shell">
        {/* 左栏：账号 + 歌单 */}
        <div className="profile-left">
          {/* 账号区 */}
          <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', padding: '4px 4px 8px' }}>音源账号</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources_.map((s) => {
              const c = getSourceCreds(s.id);
              const isLoggedIn = c.isLoggedIn;
              const color = SOURCE_COLOR[s.id] || '#888';
              const isExpanded = expandedSourceId === s.id;
              const isSelected = selectedSourceId === s.id && isLoggedIn;
              return (
                <div key={s.id} className="glass-panel" style={{ borderRadius: 16, padding: isExpanded ? 12 : 10, border: isSelected ? `1px solid ${color}55` : '1px solid rgba(255,255,255,0.06)' }}>
                  {isLoggedIn ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${color}55`, boxShadow: `0 0 0 1px ${color}22` }}>
                        {c.userInfo?.avatar ? <img src={c.userInfo.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserIcon size={20} color="var(--text-muted)" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }} onClick={() => selectSource(s.id)}>
                        <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nickname || s.name}</div>
                        <span className="source-tag" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{s.name} · 已登录</span>
                      </div>
                      <button onClick={() => logout(s.id)} className="glass-button" style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff9fa6', flexShrink: 0 }} title="退出该音源">
                        <LogOut size={15} />
                      </button>
                    </div>
                  ) : s.ready ? (
                    <div>
                      <button onClick={() => setExpandedSourceId(isExpanded ? null : s.id)} className="glass-button" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        <QrCode size={16} /> {isExpanded ? '收起' : `扫码登录${s.name}`}
                      </button>
                      {isExpanded && (
                        <div style={{ marginTop: 10 }}>
                          <QrLoginView sourceId={s.id} compact onConfirmed={(creds) => handleLoginConfirmed(s.id, creds)} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6 }}>
                      <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <UserIcon size={20} color="var(--text-muted)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</div>
                        <span className="source-tag" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }}>开发中</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 歌单列表 */}
          {selectedCreds.isLoggedIn && (
            <>
              <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', padding: '16px 4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{getSource(selectedSourceId)?.name || '音源'}歌单</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{playlists.length} 个</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 2px' }}>
                {loadingPlaylists ? <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 size={22} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /></div>
                  : playlists.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>暂无歌单</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {playlists.map((pl) => (
                        <button key={pl.id} onClick={() => openPlaylistDetail(pl)} className={`glass-row ${playlistDetail?.name === pl.name ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, textAlign: 'left' }}>
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
                    </div>}
              </div>
            </>
          )}
          {!selectedCreds.isLoggedIn && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
              选择上方已登录音源查看歌单，<br />或扫码登录一个音源
            </div>
          )}
        </div>

        {/* 右栏：歌单详情 */}
        <div className="profile-right" style={{ minHeight: 0 }}>
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
