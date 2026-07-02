import { useEffect } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Login from './pages/Login';
import Player from './pages/Player';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const showLogin = useAuthStore((s) => s.showLogin);
  const setShowLogin = useAuthStore((s) => s.setShowLogin);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  useEffect(() => {
    if (isLoggedIn) fetchUserInfo();
  }, [isLoggedIn, fetchUserInfo]);

  // 未登录但用户主动点开登录页 → 显示 Login；否则始终显示 Player
  if (!isLoggedIn && showLogin) {
    return (
      <div style={{ height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
        <Login onBack={() => setShowLogin(false)} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      <Player />
    </div>
  );
}
