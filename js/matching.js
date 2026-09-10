/* 報名資料處理 —— 規格 §10
   status / matchedId 皆為衍生欄位，每次拉取回覆全部重算（§10.1.1）。 */

const Matching = {
  /* @param regs  registrations 原始陣列（含 rawId / guild / attend / timeAnswerIndex / createTime）
     @param members members.json 的 members 陣列
     @param event  active.json 的 event（需 deadline、signupTimeCorrectIndex） */
  recompute(regs, members, event) {
    const byId = new Map(members.map(m => [m.id, m]));
    const deadline = event.deadline ? new Date(event.deadline).getTime() : null;

    // 第一輪：ID 比對 + 逾時 + 防呆題 + 公會不符
    const list = regs.map(r => {
      const rec = Object.assign({}, r);
      rec.issues = [];
      const m = byId.get(rec.rawId);          // 完全字串相符，不做任何正規化（§10.1）

      if (!m) {
        rec.matchedId = null;
        rec.status = 'unknown';
      } else {
        rec.matchedId = m.id;
        rec.status = 'ok';
        if (m.guild !== rec.guild) rec.issues.push('公會與名單不符');
      }

      if (rec.status === 'ok' && deadline && new Date(rec.createTime).getTime() > deadline) {
        rec.status = 'late';
      }
      if (rec.status === 'ok' && event.signupTimeCorrectIndex !== null &&
          event.signupTimeCorrectIndex !== undefined &&
          rec.timeAnswerIndex !== event.signupTimeCorrectIndex) {
        rec.status = 'form_error';
        rec.issues.push('活動日期選錯');
      }
      return rec;
    });

    // 第二輪：重複報名 —— 同一 matchedId 保留 createTime 最新一筆（§10.2）
    const groups = new Map();
    list.forEach(r => {
      if (r.status !== 'ok' || !r.matchedId) return;
      if (!groups.has(r.matchedId)) groups.set(r.matchedId, []);
      groups.get(r.matchedId).push(r);
    });
    groups.forEach(arr => {
      if (arr.length < 2) return;
      arr.sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
      arr.slice(1).forEach(r => { r.status = 'duplicate'; });
    });

    return list;
  },

  /* 有效報名者（含請假） */
  valid(regs) { return regs.filter(r => r.status === 'ok'); },

  /* 有效且「參加」者的 ID，作為抽獎基礎名單來源 */
  attendingIds(regs) {
    return regs.filter(r => r.status === 'ok' && r.attend === '參加').map(r => r.matchedId);
  },

  /* 分類異常，供報名異常區顯示（§7.2） */
  anomalies(regs) {
    return {
      unknown: regs.filter(r => r.status === 'unknown'),
      duplicate: regs.filter(r => r.status === 'duplicate'),
      form_error: regs.filter(r => r.status === 'form_error'),
      late: regs.filter(r => r.status === 'late'),
      guildMismatch: regs.filter(r => r.status === 'ok' && r.issues.includes('公會與名單不符'))
    };
  },

  /* 產生防呆題的 4 個選項（§8.1） */
  buildTimeOptions(eventAtIso) {
    const d = new Date(eventAtIso);
    const p = n => String(n).padStart(2, '0');
    const fmt = dt => dt.getFullYear() + '/' + p(dt.getMonth() + 1) + '/' + p(dt.getDate());
    const correctTime = p(d.getHours()) + ':' + p(d.getMinutes());
    const correct = fmt(d) + ' ' + correctTime;

    const opts = new Set([correct]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 200) {
      const offset = Math.floor(Math.random() * 7) - 3;              // 前後 3 天
      const slot = CONFIG.TIME_SLOTS[Math.floor(Math.random() * CONFIG.TIME_SLOTS.length)];
      const dd = new Date(d.getTime());
      dd.setDate(dd.getDate() + offset);
      opts.add(fmt(dd) + ' ' + slot);
    }
    const arr = Array.from(opts);
    for (let i = arr.length - 1; i > 0; i--) {                        // 打亂
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return { options: arr, correctIndex: arr.indexOf(correct) };
  }
};
