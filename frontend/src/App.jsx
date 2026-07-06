import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const neteaseLoggedIn = useAuthStore((s) => s.neteaseLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);
  const fetchNeteaseUserInfo = useAuthStore((s) => s.fetchNeteaseUserInfo);

  // 默认进播放器（不强制登录）
  const [view, setView] = useState('player'); // 'player' | 'profile' | 'login'

  // 冷启动：持久化登录态时主动拉取用户信息
  useEffect(() => {
    if (isLoggedIn) fetchUserInfo();
    if (neteaseLoggedIn) fetchNeteaseUserInfo();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      setView('player');
    }
  }, [isLoggedIn, fetchUserInfo]);

  // 未登录且主动打开登录页时，全屏显示 Login（可返回）
  // 任一平台登录后也可主动进 Login 登录第二个平台
  if (view === 'login') {
    return <Login onBack={() => setView('player')} />;
  }

  // 任一平台登录即可访问 Profile
  const anyLoggedIn = isLoggedIn || neteaseLoggedIn;

  return (
    <div style={{ height: '100%', position: 'relative', background: 'transparent' }}>
      {view === 'profile' && anyLoggedIn
        ? <Profile onBack={() => setView('player')} onLogin={() => setView('login')} />
        : <Player onProfile={() => setView(anyLoggedIn ? 'profile' : 'login')} />}
    </div>
  );
}
