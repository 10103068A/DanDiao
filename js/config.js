/* 全域設定 —— 依規格 §7.1 §4 §5 */
const CONFIG = {
  /* 共用密碼：前端常數，只用來遮住管理 UI，非安全機制（§3.1） */
  PASSCODE: 'DanDiao2026',

  /* true  = DEMO 模式，資料存 localStorage，不需任何 Google 設定
     false = Drive 模式，需填好下方 GOOGLE 區塊 */
  DEMO_MODE: false,

  GOOGLE: {
    CLIENT_ID: '923647789539-1met6ovrplla6ec2ikbik8vhdt16354g.apps.googleusercontent.com',
    /* 供未登入者讀取公開檔案。瀏覽器藏不住任何值，防護靠的是憑證上的
       網站限制 + API 限制，不是把它藏起來（§14.1） */
    API_KEY: 'AIzaSyA8tR788PvHQpqGy3ulAMYBr2Ob5faGnNI',
    SCOPE: 'https://www.googleapis.com/auth/drive.file',
    /* 資料檔與表單都收在這個資料夾底下，不要散在雲端硬碟根目錄 */
    FOLDER: '蛋雕教(經典版)',
    FILE_IDS: {
      members: '1_VD8AQBha_UpxlRuKeijSpknd7Z_20S7',
      active:  '1PyTxMoTeP4GuyRplcHE3WP4jdzDoyLbc',
      history: '1HNlGZbsSddQmtY_YDGBKWMYpdqZp9yXm'
    }
  },

  GUILDS: ['蛋雕教', '蛋鵰教', '蛋鯛教'],
  /* 防呆題用的預設時段（§8.1） */
  TIME_SLOTS: ['20:00', '21:00', '22:00'],

  CHECKIN_PLEDGE: '我保證完整參加整場活動，祝我中大獎，阿拉花瓜～～'
};
