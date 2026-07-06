import { useEffect, useState } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { CookieReader } from './plugins/CookieReader';
import { netease } from './api/netease';
import Player from './pages/Player';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const neteaseLoggedIn = useAuthStore((s) => s.neteaseLoggedIn);
  const fetchUserInfo = useAuthStore((s) => s.fetchUserInfo);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setNeteaseAuth = useAuthStore((s) => s.setNeteaseAuth);

  // 默认进播放器（不强制登录）
  // 任一平台已登录 → 头像进 Profile；都未登录 → 头像进 Login
  const [view, setView] = useState('player'); // 'player' | 'profile' | 'login'

  // 冷启动：从原生 CookieManager 恢复登录态（比 localStorage 更可靠）
  useEffect(() => {
    const restoreFromCookies = async () => {
      try {
        // 恢复 QQ 音乐
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
        // 恢复网易云音乐
        if (!neteaseLoggedIn) {
          const ncm = await CookieReader.getCookiesForUrl('https://music.163.com');
          if (ncm?.cookie && ncm.cookie.includes('MUSIC_U')) {
            try {
              const info = await netease.accountInfo(ncm.cookie);
              setNeteaseAuth({
                cookie: ncm.cookie,
                uid: info?.uid || '',
                nickname: info?.nickname || '网易云用户',
              });
            } catch (e) {
              // 即使拉不到用户信息也恢复登录态，后续可重试
              setNeteaseAuth({ cookie: ncm.cookie, uid: '', nickname: '网易云用户' });
            }
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
