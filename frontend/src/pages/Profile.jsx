import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Music2, LogOut, Play, User as UserIcon, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';

function TrackRow({ track, index, active, onPlay }) {
  return (
    <button onClick={() => onPlay(track)} className={`glass-row ${active ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', textAlign: 'left' }}>
      <span style={{ width: 24, textAlign: 'center', fontSize: 12, color: active ? 'var(--accent-dynamic)' : 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
        {active ? <Play size={11} fill="currentColor" /> : index + 1}
      </span>
      <div style={{ width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
        {track.cover ? <img src={music.cover(track.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music2 size={16} color="var(--text-muted)" /></div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
      </div>
    </button>
  );
}

export default function Profile({ onBack }) {
  const { isLoggedIn, cookie, uin, userInfo, nickname, fetchUserInfo, logout, loadingInfo } = useAuthStore();
  const { playTrackFromList, currentTrack } = usePlayerStore();

  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (!isLoggedIn || !cookie || !uin) return;
    setLoadingPlaylists(true);
    try {
      const list = await music.userPlaylists(cookie, uin);
      setPlaylists(list || []);
    } catch (e) {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }, [isLoggedIn, cookie, uin]);

  useEffect(() => {
    if (isLoggedIn) {
      if (!userInfo) fetchUserInfo();
      loadPlaylists();
    }
  }, [isLoggedIn]);

  const openPlaylistDetail = async (pl) => {
    setLoadingDetail(true);
    setPlaylistDetail({ name: pl.name, tracks: [] });
    try {
      const detail = await music.playlist(pl.id, cookie);
      setPlaylistDetail({ name: detail?.name || pl.name, tracks: detail?.tracks || [] });
    } catch (e) {
      setPlaylistDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const playFromPlaylist = (track) => {
    if (playlistDetail?.tracks?.length) {
      playTrackFromList(track, playlistDetail.tracks);
    }
  };

  const playAll = () => {
    if (playlistDetail?.tracks?.length) {
      playTrackFromList(playlistDetail.tracks[0], playlistDetail.tracks);
    }
  };

  const avatar = userInfo?.avatar;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 30% 18%, rgba(0, 245, 212, .08) 0%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.85) 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部导航 */}
      <div className="glass-panel" style={{ padding: 'calc(10px + env(safe-area-inset-top)) 16px 10px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', flexShrink: 0 }}>
        <button onClick={onBack} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 760, flex: 1, letterSpacing: '.04em' }}>{playlistDetail ? playlistDetail.name : '我的音乐'}</span>
        <button onClick={() => { fetchUserInfo(); loadPlaylists(); }} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} title="刷新">
          <RefreshCw size={16} className={loadingInfo || loadingPlaylists ? 'spin-icon' : ''} />
        </button>
      </div>

      {/* 双栏内容 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 12, padding: 12 }}>
        {/* 左栏 */}
        <div className="glass-panel" style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(0, 245, 212, .32)', boxShadow: '0 0 0 1px rgba(0, 245, 212, .10)' }}>
              {avatar ? <img src={music.cover(avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserIcon size={26} color="var(--text-muted)" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 760, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{loadingInfo && !nickname ? '加载中…' : nickname}</span>
              {userInfo?.vipLevel > 0 ? (
                <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 6, marginTop: 4, background: 'linear-gradient(135deg, #fff3c2, var(--champagne), #c9963d)', color: '#201303', display: 'inline-flex', alignItems: 'center', gap: 4, boxShadow: '0 0 12px rgba(244,210,138,.24)' }}><Music2 size={10} /> 可播放 VIP 歌曲</span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, marginTop: 4, background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Music2 size={10} /> 不可播放 VIP 歌曲</span>
              )}
            </div>
          </div>

          <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', padding: '10px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span>我的歌单</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{playlists.length} 个</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 8px 8px' }}>
            {loadingPlaylists ? <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 size={22} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /></div>
              : playlists.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>暂无歌单</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {playlists.map((pl) => (
                    <button key={pl.id} onClick={() => openPlaylistDetail(pl)} className={`glass-row ${playlistDetail?.name === pl.name ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, textAlign: 'left' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {pl.cover ? <img src={music.cover(pl.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={18} color="var(--text-secondary)" />}
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

          <button onClick={logout} className="glass-button" style={{ margin: 8, padding: '11px', borderRadius: 14, fontSize: 13, fontWeight: 600, color: '#ff9fa6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
            <LogOut size={15} /> 退出登录
          </button>
        </div>

        {/* 右栏 */}
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden' }}>
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
