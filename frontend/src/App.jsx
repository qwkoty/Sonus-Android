import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  // 默认进播放器（不强制登录）
  // 已登录点头像 → Profile；未登录点头像 → Login
  const [view, setView] = useState('player'); // 'player' | 'profile' | 'login'

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      // 登录成功后确保回到播放器
      setView('player');
    }
  }, [isLoggedIn, fetchUserInfo]);

  // 未登录且主动打开登录页时，全屏显示 Login（可返回）
  if (view === 'login' && !isLoggedIn) {
    return <Login onBack={() => setView('player')} />;
  }

  return (
    <div style={{ height: '100%', position: 'relative', background: 'transparent' }}>
      {view === 'profile' && isLoggedIn
        ? <Profile onBack={() => setView('player')} />
        : <Player onProfile={() => setView(isLoggedIn ? 'profile' : 'login')} />}
    </div>
  );
}
