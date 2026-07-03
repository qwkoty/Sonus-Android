import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, ChevronRight, Loader2, Music2,
  LogOut, Play, User as UserIcon, RefreshCw,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';

function TrackRow({ track, index, active, onPlay }) {
  return (
    <button
      onClick={() => onPlay(track)}
      className={`glass-row ${active ? 'is-active' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 10px', textAlign: 'left',
      }}
    >
      <span style={{
        width: 24, textAlign: 'center', fontSize: 12,
        color: active ? 'var(--accent-dynamic)' : 'var(--text-muted)',
        fontWeight: 600, flexShrink: 0,
      }}>
        {active ? <Play size={11} fill="currentColor" /> : index + 1}
      </span>
      <div style={{
        width: 40, height: 40, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
        background: 'rgba(255,255,255,0.06)',
      }}>
        {track.cover
          ? <img src={music.cover(track.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music2 size={16} color="var(--text-muted)" /></div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)',
        }}>
          {track.title}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {track.artist}
        </div>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 顶部导航栏 - 液态玻璃 */}
      <div className="glass-panel" style={{
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none',
        flexShrink: 0,
      }}>
        <button onClick={onBack} className="glass-button" style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-primary)',
        }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
          {playlistDetail ? playlistDetail.name : '我的音乐'}
        </span>
        <button onClick={() => { fetchUserInfo(); loadPlaylists(); }} className="glass-button" style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)',
        }} title="刷新">
          <RefreshCw size={16} className={loadingInfo || loadingPlaylists ? 'spin-icon' : ''} />
        </button>
      </div>

      {/* 内容区 */}
      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '16px',
      }}>
        {playlistDetail ? (
          /* 歌单详情 */
          <div>
            <button onClick={() => setPlaylistDetail(null)} className="glass-button" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12,
              fontSize: 13, color: 'var(--text-secondary)', padding: '6px 10px',
              borderRadius: 8,
            }}>
              <ArrowLeft size={15} /> 返回歌单
            </button>

            {loadingDetail ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 size={24} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} />
              </div>
            ) : playlistDetail.tracks.length > 0 ? (
              <>
                <button onClick={playAll} className="glass-button-accent" style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '12px 14px', marginBottom: 12, borderRadius: 12,
                  fontSize: 13,
                }}>
                  <Play size={16} fill="currentColor" /> 播放全部 ({playlistDetail.tracks.length})
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {playlistDetail.tracks.map((t, i) => (
                    <TrackRow key={t.id || i} track={t} index={i}
                      active={currentTrack?.id === t.id}
                      onPlay={playFromPlaylist} />
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                歌单为空
              </div>
            )}
          </div>
        ) : (
          /* 个人主页 */
          <div>
            {/* 用户信息卡 - 液态玻璃 */}
            <div className="glass-panel" style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '16px 14px', marginBottom: 16,
              borderRadius: 16,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                background: 'rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {avatar
                  ? <img src={music.cover(avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <UserIcon size={26} color="var(--text-muted)" />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: 18, fontWeight: 700,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  display: 'block',
                }}>
                  {loadingInfo && !nickname ? '加载中…' : nickname}
                </span>
              </div>
            </div>

            {/* 歌单标题 */}
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
              padding: '4px 4px 10px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>我的歌单</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {playlists.length} 个
              </span>
            </div>

            {/* 歌单列表 - 玻璃行 */}
            {loadingPlaylists ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 size={24} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} />
              </div>
            ) : playlists.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                暂无歌单
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {playlists.map((pl) => (
                  <button key={pl.id} onClick={() => openPlaylistDetail(pl)} className="glass-row" style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 14, textAlign: 'left',
                  }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {pl.cover
                        ? <img src={music.cover(pl.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <Music2 size={20} color="var(--text-secondary)" />
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {pl.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                        {pl.songCount ?? 0} 首
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-muted)" />
                  </button>
                ))}
              </div>
            )}

            {/* 退出登录 - 玻璃危险按钮 */}
            <button onClick={logout} className="glass-button-danger" style={{
              marginTop: 24, width: '100%', padding: '13px', borderRadius: 14,
              fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <LogOut size={15} /> 退出登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
