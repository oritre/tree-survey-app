// שליחת תמונות לבוט בטלגרם, מסודרות לפי סקר ועץ
(function (root) {
  'use strict';
  const API = 'https://api.telegram.org/bot';

  async function call(token, method, body) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(API + token + '/' + method, { method: 'POST', body });
      const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
      if (j.ok) return j.result;
      if (j.error_code === 429 && j.parameters && j.parameters.retry_after) {
        await new Promise(r => setTimeout(r, (j.parameters.retry_after + 1) * 1000));
        continue;
      }
      if (j.error_code === 401 || j.error_code === 404 || (!j.error_code && (res.status === 400 || res.status === 404))) throw new Error('הטוקן לא תקין. העתק אותו שוב מ-BotFather');
      throw new Error(j.description || 'שגיאה בטלגרם');
    }
    throw new Error('טלגרם עמוס, נסה שוב מאוחר יותר');
  }

  function form(obj) {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (Array.isArray(v) && v[0] instanceof Blob) f.append(k, v[0], v[1]); else f.append(k, typeof v === 'object' && !(v instanceof Blob) ? JSON.stringify(v) : v);
    }
    return f;
  }

  const TG = {
    getMe(token) { return call(token, 'getMe', form({})); },

    // מוצא את הצ'אט האחרון ששלח הודעה לבוט (בלי לאשר את ההודעות, כדי לא לפגוע בייבוא במחשב)
    async findChat(token) {
      const ups = await call(token, 'getUpdates', form({ limit: 100, timeout: 0 }));
      for (let i = ups.length - 1; i >= 0; i--) {
        const m = ups[i].message || ups[i].edited_message || ups[i].channel_post;
        if (m && m.chat) return { id: m.chat.id, name: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username };
      }
      return null;
    },

    sendText(token, chat, text) {
      return call(token, 'sendMessage', form({ chat_id: chat, text, disable_notification: true }));
    },

    // תמונה אחת עם כיתוב. מחזיר את מספר ההודעה כדי שאפשר יהיה לעדכן את הכיתוב אחר כך
    async sendPhoto(token, chat, blob, caption) {
      const m = await call(token, 'sendPhoto', form({ chat_id: chat, caption, photo: [blob, 'tree.jpg'], disable_notification: true }));
      return m.message_id;
    },

    async editCaption(token, chat, messageId, caption) {
      try {
        await call(token, 'editMessageCaption', form({ chat_id: chat, message_id: messageId, caption }));
        return true;
      } catch (e) {
        if (/not modified/i.test(e.message)) return true;
        if (/not found|can't be edited/i.test(e.message)) return false;
        throw e;
      }
    },

    // photos: [{blob, caption}] עד 10 בקבוצה
    async sendPhotos(token, chat, photos) {
      if (photos.length === 1) {
        return call(token, 'sendPhoto', form({ chat_id: chat, caption: photos[0].caption, photo: [photos[0].blob, 'tree.jpg'], disable_notification: true }));
      }
      const f = new FormData();
      f.append('chat_id', chat);
      f.append('disable_notification', 'true');
      const media = photos.map((p, i) => {
        f.append('f' + i, p.blob, 'tree' + i + '.jpg');
        return { type: 'photo', media: 'attach://f' + i, caption: p.caption || undefined };
      });
      f.append('media', JSON.stringify(media));
      return call(token, 'sendMediaGroup', f);
    },
  };
  root.TG = TG;
})(self);
