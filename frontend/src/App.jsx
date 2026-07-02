import { useEffect } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Login from './pages/Login';
import Player from './pages/Player';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  // 已登录但还没拉过用户信息时补拉一次
  useEffect(() => {
    if (isLoggedIn) fetchUserInfo();
  }, [isLoggedIn, fetchUserInfo]);

  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      {isLoggedIn ? <Player /> : <Login />}
    </div>
  );
}
