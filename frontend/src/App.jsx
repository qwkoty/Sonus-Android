import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { CookieReader } from './plugins/CookieReader';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);
  const setAuth = useAuthStore((s) => s.setAuth);

  // 默认进播放器（不强制登录）
  const [view, setView] = useState('player'); // 'player' | 'profile' | 'login'

  // 冷启动：从原生 CookieManager 恢复 QQ 音乐登录态（比 localStorage 更可靠）
  useEffect(() => {
    const restoreFromCookies = async () => {
      try {
        if (!isLoggedIn) {
          const qq = await CookieReader.getCookiesForUrl('https://y.qq.com');
          if (qq?.loggedIn && qq.uin) {
            setAuth({
              cookie: qq.cookie,
              uin: qq.uin,
              key: qq.qqmusic_key || '',
              nickname: 'QQ音乐用户',
            });
          }
        }
      } catch (e) {
        console.warn('[App restoreFromCookies] failed', e);
      }
    };
    restoreFromCookies();
  }, []);

  // isLoggedIn 变化时拉取用户信息
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
  if (view === 'login') {
    return <Login onBack={() => setView('player')} />;
  }

  return (
    <div style={{ height: '100%', position: 'relative', background: 'transparent' }}>
      {view === 'profile' && isLoggedIn
        ? <Profile onBack={() => setView('player')} onLogin={() => setView('login')} />
        : <Player onProfile={() => setView(isLoggedIn ? 'profile' : 'login')} />}
    </div>
  );
}
