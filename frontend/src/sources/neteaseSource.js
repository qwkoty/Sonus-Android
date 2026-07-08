// 网易云音乐音源适配器（骨架 / 占位）
// 仅实现 SourceAdapter 接口形状，方法抛“暂未支持”，作为可插拔扩展点。
// 真实接通需逆向网易云 weapi/eapi 加密（AES）并做合规评估，不在本次默认范围。

const notSupported = (what) => {
  throw new Error(`[netease] 暂未支持：${what}（适配器骨架，待实现）`);
};

export const neteaseSource = {
  id: 'netease',
  name: '网易云音乐',
  loginDomains: ['https://music.163.com'],
  ready: false,

  openLogin: async () => notSupported('登录'),
  parseCredentials: () => notSupported('凭证解析'),
  validateLogin: async () => notSupported('登录校验'),

  search: () => notSupported('搜索'),
  url: () => notSupported('播放链接'),
  stream: () => notSupported('播放链接'),
  cover: (url) => url,
  lyric: () => notSupported('歌词'),
  loginByCookie: () => notSupported('Cookie 登录'),
  userInfo: () => notSupported('用户信息'),
  userPlaylists: () => notSupported('歌单列表'),
  playlist: () => notSupported('歌单详情'),
  getProxyUrl: (url) => url,
};

export default neteaseSource;
