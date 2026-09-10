/* Google Identity Services + Drive / Forms API 封裝（§4）
   DEMO_MODE 時整支不會被呼叫。 */

const GoogleAuth = {
  token: null,
  email: null,
  _client: null,

  ready() { return !!(CONFIG.GOOGLE.CLIENT_ID); },

  /* token 存 sessionStorage，讓管理頁連線一次後切到其他分頁仍可寫入。
     關掉分頁就消失；效期約 1 小時，過期後任一寫入會收到 401，需重新連線。 */
  _save() {
    sessionStorage.setItem('dd_gtoken', JSON.stringify({
      token: this.token, email: this.email, exp: Date.now() + 55 * 60 * 1000
    }));
  },

  restore() {
    try {
      const raw = sessionStorage.getItem('dd_gtoken');
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.token || Date.now() > s.exp) { sessionStorage.removeItem('dd_gtoken'); return false; }
      this.token = s.token;
      this.email = s.email;
      return true;
    } catch (e) { return false; }
  },

  init() {
    this.restore();
    this._ensureClient();     // GIS 還沒載完也沒關係，連線時會再試一次
  },

  /* GIS 函式庫是 async defer 載入的，可能比本檔案晚到，
     所以建立 token client 的時機必須容忍「還沒載好」。 */
  _ensureClient() {
    if (this._client) return true;
    if (!this.ready()) return false;
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return false;
    this._client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE.CLIENT_ID,
      scope: CONFIG.GOOGLE.SCOPE + ' openid email',
      callback: () => {}
    });
    return true;
  },

  /* 必須由使用者手勢觸發（§4.2） */
  connect() {
    return new Promise((resolve, reject) => {
      if (!this.ready()) return reject(new Error('尚未設定 CLIENT_ID，請檢查 js/config.js'));
      if (!this._ensureClient()) {
        return reject(new Error('Google 登入元件尚未載入完成，請稍候再按一次'));
      }
      this._client.callback = async (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        this.token = resp.access_token;
        try { await this.fetchEmail(); } catch (e) { /* 非致命 */ }
        this._save();
        resolve(this.token);
      };
      this._client.requestAccessToken({ prompt: '' });
    });
  },

  async fetchEmail() {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + this.token }
    });
    const j = await r.json();
    this.email = j.email || null;   // 動態取得，絕不寫死在原始碼（§7.2）
    return this.email;
  },

  signOut() {
    this.token = null;
    this.email = null;
    sessionStorage.removeItem('dd_gtoken');
  }
};

const DriveAPI = {
  /* 公開讀取：官方 API 端點才支援 CORS（§15 風險 1）。

     一律先用 API 金鑰讀，不帶 token —— 因為 drive.file scope 只涵蓋
     「該帳號用本程式建立的檔案」，幹部帶著自己的 token 去讀會長的檔案
     會被 Drive 回 404，反而比不帶 token 更糟。

     金鑰讀不到才退回用 token 重試（例如檔案的公開權限被關掉，只剩擁有者讀得到）。 */
  async readJson(fileId) {
    const url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
    const byKey = await fetch(url + '&key=' + encodeURIComponent(CONFIG.GOOGLE.API_KEY));
    if (byKey.ok) return byKey.json();

    if (GoogleAuth.token) {
      const byToken = await fetch(url, { headers: { Authorization: 'Bearer ' + GoogleAuth.token } });
      if (byToken.ok) return byToken.json();
      throw new Error('讀取失敗 ' + byToken.status);
    }
    throw new Error('讀取失敗 ' + byKey.status);
  },

  async writeJson(fileId, obj) {
    if (!GoogleAuth.token) throw new Error('需會長權限');
    const r = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media',
      { method: 'PATCH',
        headers: { Authorization: 'Bearer ' + GoogleAuth.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(obj) });
    if (!r.ok) throw new Error('寫入失敗 ' + r.status);
    return r.json();
  },

  /* 問 Drive：目前登入的帳號能不能編輯這個檔案。
     用來分辨會長與幹部——幹部即使用自己的 Google 登入，對會長建的檔案也沒有權限，
     Drive 會直接回 404。不需要把會長的 email 記在任何地方（§7.2）。 */
  async canEdit(fileId) {
    if (!GoogleAuth.token) return false;
    const r = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=capabilities/canEdit',
      { headers: { Authorization: 'Bearer ' + GoogleAuth.token } });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.capabilities && j.capabilities.canEdit);
  },

  _folderId: null,

  /* 取得專用資料夾的 ID，沒有就建一個。
     drive.file scope 下 files.list 只看得到本程式建立的檔案，
     所以這個查詢不會撈到使用者其他同名資料夾。 */
  async ensureFolder() {
    if (this._folderId) return this._folderId;
    if (!GoogleAuth.token) throw new Error('需會長權限');
    const h = { Authorization: 'Bearer ' + GoogleAuth.token, 'Content-Type': 'application/json' };
    // Drive 查詢語法用單引號包字串，名稱裡若有單引號要跳脫（目前沒有，防呆用）
    const name = CONFIG.GOOGLE.FOLDER.split("'").join("\\'");

    const q = "mimeType='application/vnd.google-apps.folder' and name='" + name + "' and trashed=false";
    const found = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&q=' + encodeURIComponent(q),
      { headers: h });
    if (found.ok) {
      const j = await found.json();
      if (j.files && j.files.length) { this._folderId = j.files[0].id; return this._folderId; }
    }

    const made = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: CONFIG.GOOGLE.FOLDER,
                             mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!made.ok) throw new Error('建立資料夾失敗（' + made.status + '）');
    this._folderId = (await made.json()).id;
    return this._folderId;
  },

  /* 把檔案從根目錄搬進專用資料夾。表單是 Forms API 建的，只能事後搬 */
  async moveToFolder(fileId) {
    const folder = await this.ensureFolder();
    const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId +
                          '?addParents=' + folder + '&removeParents=root&fields=id',
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + GoogleAuth.token } });
    if (!r.ok) throw new Error('搬進資料夾失敗（' + r.status + '）');
  },

  /* 建立一個新的 JSON 檔，寫入初始內容，並設為「知道連結的人可讀」，回傳檔案 ID。
     檔案必須由本程式建立，drive.file scope 才涵蓋得到（§4.1）。 */
  async createJson(name, obj) {
    if (!GoogleAuth.token) throw new Error('需會長權限');
    const folder = await this.ensureFolder();

    const meta = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + GoogleAuth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mimeType: 'application/json', parents: [folder] })
    });
    if (!meta.ok) throw new Error('建立 ' + name + ' 失敗（' + meta.status + '）');
    const fileId = (await meta.json()).id;

    await this.writeJson(fileId, obj);

    const perm = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + GoogleAuth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' })
    });
    if (!perm.ok) throw new Error(name + ' 的公開讀取權限設定失敗（' + perm.status + '）');

    return fileId;
  }
};

/* 表單建立流程 —— §8.2 的五個步驟，第 3 步不可省略 */
const FormsAPI = {
  async _call(url, method, body) {
    const r = await fetch(url, {
      method: method,
      headers: { Authorization: 'Bearer ' + GoogleAuth.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error(method + ' ' + url + ' -> ' + r.status);
    return r.json();
  },

  async create(title, description, questions) {
    /* title 是表單內顯示的標題，documentTitle 是雲端硬碟上的檔名。
       不給 documentTitle 的話，Drive 裡會叫「未命名表單」，而且只能在建立時指定。 */
    const form = await this._call('https://forms.googleapis.com/v1/forms', 'POST',
      { info: { title: title, documentTitle: title } });
    const formId = form.formId;

    const requests = [{ updateFormInfo: { info: { description: description }, updateMask: 'description' } }];
    questions.forEach((q, i) => {
      requests.push({ createItem: { item: { title: q.title, questionItem: { question: q.q }, description: q.desc },
                                    location: { index: i } } });
    });
    await this._call('https://forms.googleapis.com/v1/forms/' + formId + ':batchUpdate', 'POST',
      { requests: requests });

    await this._call('https://forms.googleapis.com/v1/forms/' + formId + ':setPublishSettings', 'POST',
      { publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } } });

    await this._call('https://www.googleapis.com/drive/v3/files/' + formId + '/permissions', 'POST',
      { type: 'anyone', role: 'reader', view: 'published' });

    // Forms API 不能指定位置，建完才搬得動；搬失敗不影響表單本身可用
    try { await DriveAPI.moveToFolder(formId); } catch (e) { /* 留在根目錄也還能用 */ }

    const full = await this._call('https://forms.googleapis.com/v1/forms/' + formId, 'GET');
    return { formId: formId, url: full.responderUri };
  },

  async setAccepting(formId, accepting) {
    return this._call('https://forms.googleapis.com/v1/forms/' + formId + ':setPublishSettings', 'POST',
      { publishSettings: { publishState: { isPublished: true, isAcceptingResponses: !!accepting } } });
  },

  async responses(formId) {
    const j = await this._call('https://forms.googleapis.com/v1/forms/' + formId + '/responses', 'GET');
    return j.responses || [];
  }
};
