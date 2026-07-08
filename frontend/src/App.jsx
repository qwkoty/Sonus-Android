import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Profile from './pages/Profile';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  // 默认进播放器（不强制登录）
  // 头像点击统一进入 Profile：已登录看账户/歌单；未登录在内嵌扫码登录
  const [view, setView] = useState('player'); // 'player' | 'profile'

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      setView('player');
    }
  }, [isLoggedIn, fetchUserInfo]);

  // 启动页由 HTML 内嵌脚本独立控制，需用户点击品牌名/任意处进入，
  // React 不再主动隐藏 splash，避免打断完整的品牌动画。

  return (
    <div style={{ height: '100%', position: 'relative', background: 'transparent' }}>
      {view === 'profile'
        ? <Profile onBack={() => setView('player')} />
        : <Player onProfile={() => setView('profile')} />}
    </div>
  );
}
