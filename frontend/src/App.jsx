import { useEffect } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  useEffect(() => {
    if (isLoggedIn) fetchUserInfo();
  }, [isLoggedIn, fetchUserInfo]);

  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      {isLoggedIn ? <Player /> : <Login />}
    </div>
  );
}
