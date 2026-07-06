import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const neteaseLoggedIn = useAuthStore((s) => s.neteaseLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);

  // 默认进播放器（不强制登录）
  // 任一平台已登录 → 头像进 Profile；都未登录 → 头像进 Login
  const [view, setView] = useState('player'); // 'player' | 'profile' | 'login'

  // 冷启动：持久化登录态 isLoggedIn 初始即为 true 时不会触发上面的 effect
  // 所以在 mount 时主动拉取一次用户信息
  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchUserInfo();
      // 登录成功后确保回到播放器
      setView('player');
    }
  }, [isLoggedIn, fetchUserInfo]);

  // 启动页由 HTML 内嵌脚本独立控制，需用户点击品牌名/任意处进入，
  // React 不再主动隐藏 splash，避免打断完整的品牌动画。

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
