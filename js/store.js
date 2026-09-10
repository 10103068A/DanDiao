/* 儲存抽象層：DEMO（localStorage）/ DRIVE（Google Drive）
   兩者介面相同，切換只改 CONFIG.DEMO_MODE。 */

const KEYS = { members: 'dd_members', active: 'dd_active', history: 'dd_history' };

const Store = {
  connected: false,
  email: null,
  isOwner: null,      // true = 這個帳號能寫入資料檔；false = 不能；null = 還無從判斷
  ownerReady: Promise.resolve(),   // 權限探測完成的 promise，供呼叫端與讀取並行等待

  get demo() { return CONFIG.DEMO_MODE; },

  /* 能寫入的三個條件：已連線、聖所已選定、不是「確定沒權限」。
     isOwner 為 null（探測失敗）時仍允許嘗試，真的沒權限會被 Drive 擋掉。
     注意：「創立教典紀事 / 另擇聖所安置」不受這個限制，它只需要 connected，
     否則在還沒選定聖所、或登入了別的帳號時就永遠無法建立新的聖所。 */
  canWrite() { return this.connected && this.configured() && this.isOwner === true; },

  /* 三個檔案 ID 都填好了才算設定完成 */
  configured() {
    if (this.demo) return true;
    const f = CONFIG.GOOGLE.FILE_IDS;
    return !!(f.members && f.active && f.history);
  },

  async init() {
    if (this.demo) {
      if (!localStorage.getItem(KEYS.members)) await this.seed();
      this.connected = sessionStorage.getItem('dd_demo_conn') === '1';
      this.email = this.connected ? 'guildmaster@gmail.com' : null;
      this.isOwner = true;
      this.ownerReady = Promise.resolve();
    } else {
      GoogleAuth.init();          // 內含 restore()：沿用本分頁先前的授權
      this.connected = !!GoogleAuth.token;
      this.email = GoogleAuth.email;
      // 不 await：權限探測要一趟網路往返，讓它跟讀取資料並行
      this.ownerReady = this.checkOwner();
    }
  },

  /* 用 Drive 的 canEdit 判斷這個帳號是不是會長，不記錄任何身分資訊 */
  async checkOwner() {
    this.isOwner = null;
    if (this.demo) { this.isOwner = true; return; }
    const id = CONFIG.GOOGLE.FILE_IDS.active;
    if (!this.connected || !id) return;         // 檔案還沒建立，無從判斷
    try { this.isOwner = await DriveAPI.canEdit(id); }
    catch (e) { this.isOwner = null; }
  },

  /* 建立三個資料檔並設為公開可讀，回傳檔案 ID。首次設定與「更換儲存位置」共用。
     檔案永遠建在目前連線的帳號，舊檔案不會被動到。 */
  async initFiles() {
    if (this.demo) throw new Error('DEMO 模式不需要初始化');
    if (!this.connected) throw new Error('請先連線 Google');
    // 已設定過也允許再建：這是「更換儲存位置」，新檔案要等 config.js 改了才生效

    // 一律建立空檔案，不帶 DEMO 假資料；成員名單之後用匯入名單建立
    return {
      members: await DriveAPI.createJson('members.json',
                 { updatedAt: new Date().toISOString(), members: [] }),
      active: await DriveAPI.createJson('active.json', { event: null }),
      history: await DriveAPI.createJson('history.json', { events: [] })
    };
  },

  async seed() {
    const r = await fetch('data/seed.json');
    const s = await r.json();
    localStorage.setItem(KEYS.members, JSON.stringify(s.members));
    localStorage.setItem(KEYS.active, JSON.stringify(s.active));
    localStorage.setItem(KEYS.history, JSON.stringify(s.history));
  },

  async connect() {
    if (this.demo) {
      this.connected = true;
      this.email = 'guildmaster@gmail.com';
      sessionStorage.setItem('dd_demo_conn', '1');
      return this.email;
    }
    await GoogleAuth.connect();
    this.connected = !!GoogleAuth.token;
    this.email = GoogleAuth.email;
    await this.checkOwner();
    return this.email;
  },

  disconnect() {
    if (this.demo) sessionStorage.removeItem('dd_demo_conn');
    else GoogleAuth.signOut();
    this.connected = false;
    this.email = null;
    this.isOwner = null;
  },

  /* 本機快取：讓切換頁面時先有畫面可看，再背景跟雲端對答案。
     key 綁定檔案 ID，換了聖所就不會沿用舊聖所的資料。 */
  _cacheKey(kind) { return 'dd_cache_' + (CONFIG.GOOGLE.FILE_IDS[kind] || kind); },

  readLocal(kind) {
    if (this.demo) return null;                 // DEMO 本來就讀本機，不需要這層
    try {
      const raw = localStorage.getItem(this._cacheKey(kind));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  _putCache(kind, obj) {
    if (this.demo) return;
    try { localStorage.setItem(this._cacheKey(kind), JSON.stringify(obj)); } catch (e) { /* 滿了就算了 */ }
  },

  async read(kind) {
    if (this.demo) {
      const raw = localStorage.getItem(KEYS[kind]);
      return raw ? JSON.parse(raw) : null;
    }
    const id = CONFIG.GOOGLE.FILE_IDS[kind];
    if (!id) throw new Error('尚未設定 ' + kind + ' 的檔案 ID');
    const data = await DriveAPI.readJson(id);
    this._putCache(kind, data);
    return data;
  },

  async write(kind, obj) {
    if (!this.canWrite()) throw new Error('需會長權限（請先連線 Google）');
    if (this.demo) {
      localStorage.setItem(KEYS[kind], JSON.stringify(obj));
      return obj;
    }
    const res = await DriveAPI.writeJson(CONFIG.GOOGLE.FILE_IDS[kind], obj);
    this._putCache(kind, obj);      // 寫成功後快取跟著更新，切頁面不會看到舊值
    return res;
  },

  /* 匯出全部（§13） */
  async exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      members: await this.read('members'),
      active: await this.read('active'),
      history: await this.read('history')
    };
  },

  async importAll(bundle) {
    if (!this.canWrite()) throw new Error('需會長權限');
    if (bundle.members) await this.write('members', bundle.members);
    if (bundle.active) await this.write('active', bundle.active);
    if (bundle.history) await this.write('history', bundle.history);
  },

  async resetDemo() {
    localStorage.removeItem(KEYS.members);
    localStorage.removeItem(KEYS.active);
    localStorage.removeItem(KEYS.history);
    await this.seed();
  }
};

/* 表單服務：DEMO 模式產生假表單與假回覆，讓整條流程能離線走完 */
const FormService = {
  async createSignup(event) {
    if (Store.demo) {
      const id = 'demo_signup_' + Math.random().toString(36).slice(2, 8);
      return { formId: id, url: 'https://forms.gle/DEMO-' + id.slice(-6) };
    }
    const qs = [
      { title: '角色 ID', desc: '請完整輸入你的角色 ID，大小寫需相符',
        q: { required: true, textQuestion: {} } },
      { title: '公會',
        q: { required: true, choiceQuestion: { type: 'DROP_DOWN',
             options: CONFIG.GUILDS.map(g => ({ value: g })) } } },
      { title: '參加活動 / 請假',
        q: { required: true, choiceQuestion: { type: 'RADIO',
             options: [{ value: '參加' }, { value: '請假' }] } } },
      { title: '活動時間確認',
        q: { required: true, choiceQuestion: { type: 'RADIO',
             options: event.signupTimeOptions.map(o => ({ value: o })) } } }
    ];
    return FormsAPI.create(event.name + ' 報名表', '活動時間：' + U.fmtDateTime(event.eventAt), qs);
  },

  async createCheckin(event) {
    if (Store.demo) {
      const id = 'demo_checkin_' + Math.random().toString(36).slice(2, 8);
      return { formId: id, url: 'https://forms.gle/DEMO-' + id.slice(-6) };
    }
    const qs = [
      { title: '角色 ID', q: { required: true, textQuestion: {} } },
      { title: '簽到碼', q: { required: true, textQuestion: {} } },
      { title: CONFIG.CHECKIN_PLEDGE,
        q: { required: true, choiceQuestion: { type: 'CHECKBOX', options: [{ value: '我保證' }] } } }
    ];
    return FormsAPI.create(event.name + ' 簽到表', '簽到碼由會長於活動中公布', qs);
  },

  async closeForm(formId) {
    if (Store.demo) return true;
    return FormsAPI.setAccepting(formId, false);
  },

  /* 拉取報名回覆：DEMO 模式依成員庫隨機生成，含各類異常樣本 */
  async fetchSignupResponses(event, members) {
    if (!Store.demo) {
      const raw = await FormsAPI.responses(event.signupFormId);
      return raw.map(r => {
        const ans = Object.values(r.answers || {}).map(a => a.textAnswers.answers[0].value);
        return { responseId: r.responseId, createTime: r.createTime,
                 rawId: ans[0], guild: ans[1], attend: ans[2],
                 timeAnswerIndex: event.signupTimeOptions.indexOf(ans[3]) };
      });
    }
    return DemoData.signupResponses(event, members);
  },

  async fetchCheckinResponses(event) {
    if (!Store.demo) {
      const raw = await FormsAPI.responses(event.checkinFormId);
      return raw.map(r => {
        const ans = Object.values(r.answers || {}).map(a => a.textAnswers.answers[0].value);
        return { responseId: r.responseId, createTime: r.createTime, rawId: ans[0], code: ans[1] };
      });
    }
    return DemoData.checkinResponses(event);
  }
};

/* DEMO 假資料產生器 */
const DemoData = {
  signupResponses(event, members) {
    const pick = members.slice(0, Math.max(6, Math.floor(members.length * 0.8)));
    // 以截止時間往前推，確保多數樣本在期限內（沒設截止就用現在）
    const now = event.deadline ? new Date(event.deadline).getTime() - 3600000 : Date.now();
    const out = [];
    let n = 0;
    pick.forEach(m => {
      n++;
      out.push({ responseId: 'demo_r' + n,
                 createTime: new Date(now - 172800000 + n * 60000).toISOString(),
                 rawId: m.id, guild: m.guild,
                 attend: Math.random() < 0.15 ? '請假' : '參加',
                 timeAnswerIndex: event.signupTimeCorrectIndex });
    });

    // 異常樣本：填錯 ID、重複報名、防呆題答錯、公會不符
    out.push({ responseId: 'demo_x1', createTime: new Date(now - 3600000).toISOString(),
               rawId: '99999', guild: CONFIG.GUILDS[CONFIG.GUILDS.length - 1], attend: '參加',
               timeAnswerIndex: event.signupTimeCorrectIndex });
    if (pick[0]) out.push({ responseId: 'demo_x2', createTime: new Date(now - 1800000).toISOString(),
               rawId: pick[0].id, guild: pick[0].guild, attend: '參加',
               timeAnswerIndex: event.signupTimeCorrectIndex });
    if (pick[1]) out.push({ responseId: 'demo_x3', createTime: new Date(now - 1700000).toISOString(),
               rawId: pick[1].id, guild: pick[1].guild, attend: '參加',
               timeAnswerIndex: (event.signupTimeCorrectIndex + 1) % 4 });
    if (pick[2]) out.push({ responseId: 'demo_x4', createTime: new Date(now - 1600000).toISOString(),
               rawId: pick[2].id,
               guild: CONFIG.GUILDS.find(g => g !== pick[2].guild) || pick[2].guild, attend: '參加',
               timeAnswerIndex: event.signupTimeCorrectIndex });
    // 逾時樣本（截止後才送出）
    if (event.deadline && pick[3]) {
      out.push({ responseId: 'demo_x5',
                 createTime: new Date(new Date(event.deadline).getTime() + 600000).toISOString(),
                 rawId: pick[3].id, guild: pick[3].guild, attend: '參加',
                 timeAnswerIndex: event.signupTimeCorrectIndex });
    }
    return out;
  },

  checkinResponses(event) {
    const valid = (event.registrations || []).filter(r => r.status === 'ok' && r.attend === '參加');
    const now = Date.now();
    const out = [];
    valid.forEach((r, i) => {
      if (Math.random() < 0.75) {
        out.push({ responseId: 'demo_c' + i, createTime: new Date(now - i * 30000).toISOString(),
                   rawId: r.matchedId, code: event.checkinCode });
      }
    });
    out.push({ responseId: 'demo_cx', createTime: new Date(now).toISOString(),
               rawId: '88888', code: event.checkinCode });        // 不在成員名單
    if (valid[0]) out.push({ responseId: 'demo_cy', createTime: new Date(now).toISOString(),
               rawId: valid[0].matchedId, code: '0000' });        // 簽到碼填錯
    return out;
  }
};
