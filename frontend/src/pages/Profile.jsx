import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Music2, LogOut, Play, User as UserIcon, RefreshCw, Cloud } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { usePlayerStore } from '../store/usePlayerStore';
import { music } from '../api/music';
import { netease } from '../api/netease';

function TrackRow({ track, index, active, onPlay }) {
  if (!track || !track.id) return null;
  return (
    <button onClick={() => onPlay(track)} className={`glass-row ${active ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', textAlign: 'left' }}>
      <span style={{ width: 24, textAlign: 'center', fontSize: 12, color: active ? 'var(--accent-dynamic)' : 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
        {active ? <Play size={11} fill="currentColor" /> : index + 1}
      </span>
      <div style={{ width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
        {track.cover ? <img src={coverFor(track)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music2 size={16} color="var(--text-muted)" /></div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? 'var(--accent-dynamic)' : 'var(--text-primary)' }}>{track.title || '未知歌曲'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist || '未知歌手'}</div>
      </div>
    </button>
  );
}

// 取封面 URL：QQ 走代理包装，网易云直接用原始链接
function coverFor(track) {
  if (!track) return '';
  if (track.platform === 'ncm') return track.cover;
  return music.cover(track.cover);
}

export default function Profile({ onBack }) {
  const {
    isLoggedIn, cookie, uin, userInfo, nickname, fetchUserInfo, logout, loadingInfo,
    neteaseLoggedIn, neteaseCookie, neteaseUid, neteaseUserInfo, neteaseNickname,
    fetchNeteaseUserInfo, neteaseLogout, loadingNeteaseInfo,
  } = useAuthStore();
  const { playTrackFromList, currentTrack } = usePlayerStore();

  // 当前选中的平台 tab：'qq' | 'ncm'
  const [platform, setPlatform] = useState('qq');

  // QQ 歌单
  const [qqPlaylists, setQqPlaylists] = useState([]);
  const [loadingQqPlaylists, setLoadingQqPlaylists] = useState(false);
  // 网易云歌单
  const [ncmPlaylists, setNcmPlaylists] = useState([]);
  const [loadingNcmPlaylists, setLoadingNcmPlaylists] = useState(false);

  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadQqPlaylists = useCallback(async () => {
    if (!isLoggedIn || !cookie || !uin) return;
    setLoadingQqPlaylists(true);
    try {
      const list = await music.userPlaylists(cookie, uin);
      setQqPlaylists(list || []);
    } catch (e) {
      setQqPlaylists([]);
    } finally {
      setLoadingQqPlaylists(false);
    }
  }, [isLoggedIn, cookie, uin]);

  const loadNcmPlaylists = useCallback(async () => {
    if (!neteaseLoggedIn || !neteaseUid || !neteaseCookie) return;
    setLoadingNcmPlaylists(true);
    try {
      const list = await netease.userPlaylists(neteaseUid, neteaseCookie);
      setNcmPlaylists(list || []);
    } catch (e) {
      setNcmPlaylists([]);
    } finally {
      setLoadingNcmPlaylists(false);
    }
  }, [neteaseLoggedIn, neteaseUid, neteaseCookie]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      loadQqPlaylists();
    }
  }, [isLoggedIn, fetchUserInfo, loadQqPlaylists]);

  useEffect(() => {
    if (neteaseLoggedIn) {
      fetchNeteaseUserInfo();
      loadNcmPlaylists();
    }
  }, [neteaseLoggedIn, fetchNeteaseUserInfo, loadNcmPlaylists]);

  // 切换平台 tab 时如果网易云尚未加载则触发加载
  useEffect(() => {
    if (platform === 'ncm' && neteaseLoggedIn && ncmPlaylists.length === 0 && !loadingNcmPlaylists) {
      loadNcmPlaylists();
    }
  }, [platform, neteaseLoggedIn, ncmPlaylists.length, loadingNcmPlaylists, loadNcmPlaylists]);

  // 当前平台可见的歌单
  const visiblePlaylists = platform === 'ncm' ? ncmPlaylists : qqPlaylists;
  const loadingPlaylists = platform === 'ncm' ? loadingNcmPlaylists : loadingQqPlaylists;

  const openPlaylistDetail = async (pl) => {
    setLoadingDetail(true);
    setPlaylistDetail({ name: pl.name, tracks: [], platform });
    try {
      let detail;
      if (platform === 'ncm') {
        detail = await netease.playlist(pl.id, neteaseCookie);
      } else {
        detail = await music.playlist(pl.id, cookie);
      }
      setPlaylistDetail({ name: detail?.name || pl.name, tracks: detail?.tracks || [], platform });
    } catch (e) {
      setPlaylistDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const playFromPlaylist = (track) => {
    if (!track || !playlistDetail?.tracks?.length) return;
    try {
      playTrackFromList(track, playlistDetail.tracks);
    } catch (e) {
      console.error('播放歌单歌曲失败', e);
    }
  };

  const playAll = () => {
    if (playlistDetail?.tracks?.length) {
      playTrackFromList(playlistDetail.tracks[0], playlistDetail.tracks);
    }
  };

  // ===== 当前平台用户信息 =====
  const isNcm = platform === 'ncm';
  const currentAvatar = isNcm ? (neteaseUserInfo?.avatar || '') : (userInfo?.avatar || (uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : ''));
  const currentNickname = isNcm ? neteaseNickname : nickname;
  const currentLoadingInfo = isNcm ? loadingNeteaseInfo : loadingInfo;
  const currentSubText = isNcm
    ? (neteaseUid ? `网易云账号 · ${neteaseUid}` : '网易云账号')
    : (userInfo?.follow > 0 || userInfo?.fans > 0 ? `关注 ${userInfo.follow || 0} · 粉丝 ${userInfo.fans || 0}` : 'QQ音乐账号');

  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => { setAvatarError(false); }, [currentAvatar, platform]);

  const AvatarImg = ({ iconSize = 26 }) => (
    currentAvatar && !avatarError ? (
      <img
        src={isNcm ? currentAvatar : music.cover(currentAvatar)}
        alt=""
        onError={() => setAvatarError(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : (
      <UserIcon size={iconSize} color="var(--text-muted)" />
    )
  );

  const handleLogout = () => {
    if (isNcm) {
      neteaseLogout();
      setPlatform('qq');
    } else {
      logout();
    }
  };

  const handleRefresh = () => {
    if (isNcm) {
      fetchNeteaseUserInfo();
      loadNcmPlaylists();
    } else {
      fetchUserInfo();
      loadQqPlaylists();
    }
  };

  // 顶部导航标题
  const navTitle = playlistDetail ? playlistDetail.name : '我的音乐';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 30% 18%, rgba(0, 245, 212, .08) 0%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.85) 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部导航 */}
      <div className="glass-panel" style={{ padding: 'calc(10px + env(safe-area-inset-top)) 16px 10px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', flexShrink: 0 }}>
        <button onClick={onBack} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 760, flex: 1, letterSpacing: '.04em' }}>{navTitle}</span>
        <button onClick={handleRefresh} className="glass-button" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} title="刷新">
          <RefreshCw size={16} className={(isNcm ? loadingNeteaseInfo : loadingInfo) || loadingPlaylists ? 'spin-icon' : ''} />
        </button>
      </div>

      {/* 双栏内容 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 12, padding: 12 }}>
        {/* 左栏 */}
        <div className="glass-panel" style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden' }}>
          {/* 平台 tab 切换器 */}
          <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0', flexShrink: 0 }}>
            <PlatformTab active={platform === 'qq'} onClick={() => setPlatform('qq')} icon={<Music2 size={14} />} label="QQ音乐" />
            {neteaseLoggedIn && (
              <PlatformTab active={platform === 'ncm'} onClick={() => setPlatform('ncm')} icon={<Cloud size={14} />} label="网易云" />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${isNcm ? 'rgba(230, 0, 38, .32)' : 'rgba(0, 245, 212, .32)'}`, boxShadow: '0 0 0 1px rgba(255,255,255,.06)' }}>
              <AvatarImg iconSize={26} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 760, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{currentLoadingInfo && !currentNickname ? '加载中…' : currentNickname}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>{currentSubText}</span>
            </div>
          </div>

          <div style={{ fontSize: 10, fontWeight: 760, letterSpacing: '.14em', color: 'var(--fc-muted)', textTransform: 'uppercase', padding: '10px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span>我的歌单</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visiblePlaylists.length} 个</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 8px 8px' }}>
            {!isLoggedIn && !neteaseLoggedIn ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>请先登录</div>
            ) : loadingPlaylists ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 size={22} className="spin-icon" style={{ color: 'var(--accent-dynamic)' }} /></div>
            ) : visiblePlaylists.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>暂无歌单</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visiblePlaylists.map((pl) => (
                  <button key={`${platform}_${pl.id}`} onClick={() => openPlaylistDetail(pl)} className={`glass-row ${playlistDetail?.name === pl.name ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, textAlign: 'left' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {pl.cover ? <img src={isNcm ? pl.cover : music.cover(pl.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={18} color="var(--text-secondary)" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{pl.songCount ?? 0} 首</div>
                    </div>
                    <ChevronRight size={15} color="var(--text-muted)" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleLogout} className="glass-button" style={{ margin: 8, padding: '11px', borderRadius: 14, fontSize: 13, fontWeight: 600, color: '#ff9fa6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
            <LogOut size={15} /> 退出{isNcm ? '网易云' : 'QQ'}登录
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

// 平台 tab 子组件
function PlatformTab({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="glass-button"
      style={{
        flex: 1,
        padding: '8px 10px',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        color: active ? 'var(--accent-dynamic)' : 'var(--text-secondary)',
        background: active ? 'rgba(0, 245, 212, .08)' : 'transparent',
        border: active ? '1px solid rgba(0, 245, 212, .25)' : '1px solid transparent',
      }}
    >
      {icon} {label}
    </button>
  );
}
