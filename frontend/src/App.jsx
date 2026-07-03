import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  // 已登录后，在 Player 与 Profile 两个独立页面间切换
  const [page, setPage] = useState('player');

  useEffect(() => {
    if (isLoggedIn) fetchUserInfo();
  }, [isLoggedIn, fetchUserInfo]);

  // 未登录退出到登录页；登录后默认进 Player
  if (!isLoggedIn) return <Login />;

  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      {page === 'profile'
        ? <Profile onBack={() => setPage('player')} />
        : <Player onProfile={() => setPage('profile')} />}
    </div>
  );
}
