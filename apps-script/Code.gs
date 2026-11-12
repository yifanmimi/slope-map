/**
 * 邊坡圖資編號查詢：後台 API（Google Apps Script）
 * 前台在 GitHub Pages，使用者用 Google 帳號登入，前台把登入憑證送來這裡驗證。
 *
 * 權限：看「邊坡圖資資料.json」在雲端硬碟的共用設定
 *   - 共用為檢視者／留言者 → 可以查詢
 *   - 共用為編輯者（或擁有者）→ 可以更換圖資
 *   - 其他帳號 → 拒絕
 *
 * 部署：執行身分「我」，存取權「所有人」
 * 指令碼屬性：CLIENT_ID（必填）、GOOGLE_MAPS_KEY（選填，Google 底圖用）
 */

const DATA_FILE_NAME = '邊坡圖資資料.json';
const DEFAULT_SOURCE = 'https://www.google.com/maps/d/viewer?mid=1sAfTasaC9TFY6UplMoaOUziEq9VAL78';
const props = PropertiesService.getScriptProperties();
const cache = CacheService.getScriptCache();

/** 在編輯器執行一次：建立圖資檔 */
function setup() {
  let id = props.getProperty('FILE_ID');
  if (!id) {
    const file = DriveApp.createFile(DATA_FILE_NAME, '', 'application/json');
    id = file.getId();
    props.setProperty('FILE_ID', id);
    props.setProperty('SOURCE', DEFAULT_SOURCE);
  }
  Logger.log('圖資檔：' + DriveApp.getFileById(id).getUrl());
  if (!props.getProperty('CLIENT_ID')) Logger.log('還沒設定指令碼屬性 CLIENT_ID');
}

function doGet() {
  return json_({ ok: true, message: '邊坡圖資 API 運作中' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const email = verify_(req.token);
    const role = role_(email);
    if (!role) return json_({ error: 'NO_ACCESS', email: email, message: email + ' 沒有使用權限，請聯絡管理員。' });
    const needEdit = () => { if (role !== 'edit') throw new Error('你只有查看權限，不能更換圖資。'); };
    switch (req.action) {
      case 'get': return json_(getData_(email, role));
      case 'save': needEdit(); return json_(saveData_(req.data));
      case 'fetchMyMaps': needEdit(); return json_({ kml: fetchMyMaps_(req.url) });
      default: throw new Error('未知的動作');
    }
  } catch (err) {
    return json_({ error: err.code || 'ERROR', message: String(err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, msg) { const e = new Error(msg); e.code = code; throw e; }

/** 驗證 Google 登入憑證，回傳 email */
function verify_(token) {
  if (!token) fail_('TOKEN', '請先登入');
  const clientId = props.getProperty('CLIENT_ID');
  if (!clientId) fail_('SETUP', '後台尚未設定 CLIENT_ID');
  const key = 'tk_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('TOKEN', '登入已過期');
  const info = JSON.parse(res.getContentText());
  const okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== clientId || !okIss || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now())
    fail_('TOKEN', '登入憑證無效');
  const email = String(info.email).toLowerCase();
  const ttl = Math.max(1, Math.min(1800, Number(info.exp) - Math.floor(Date.now() / 1000) - 30));
  cache.put(key, email, ttl);
  return email;
}

function file_() {
  if (!props.getProperty('FILE_ID')) setup();
  return DriveApp.getFileById(props.getProperty('FILE_ID'));
}

/** 依雲端硬碟共用名單判斷權限（快取 5 分鐘） */
function role_(email) {
  let lists = cache.get('acl');
  if (lists) lists = JSON.parse(lists);
  else {
    const f = file_();
    const em = u => String(u.getEmail()).toLowerCase();
    const edit = f.getEditors().map(em);
    try { edit.push(em(f.getOwner())); } catch (e) {}
    lists = { edit: edit, view: f.getViewers().map(em) };
    cache.put('acl', JSON.stringify(lists), 300);
  }
  if (lists.edit.indexOf(email) >= 0) return 'edit';
  if (lists.view.indexOf(email) >= 0) return 'view';
  return null;
}

/** 改完共用名單想立刻生效，可在編輯器執行這個 */
function clearAccessCache() { cache.remove('acl'); }

function getData_(email, role) {
  const f = file_();
  return {
    email: email,
    canEdit: role === 'edit',
    data: f.getBlob().getDataAsString('UTF-8') || null,
    updated: f.getLastUpdated().toISOString(),
    source: role === 'edit' ? (props.getProperty('SOURCE') || DEFAULT_SOURCE) : '',
    google: googleTiles_()
  };
}

function saveData_(json) {
  const obj = JSON.parse(json);
  if (!obj || !Array.isArray(obj.points) || !obj.points.length) throw new Error('圖資內容是空的。');
  file_().setContent(json);
  return { updated: new Date().toISOString() };
}

function fetchMyMaps_(url) {
  const src = String(url || props.getProperty('SOURCE') || DEFAULT_SOURCE).trim();
  const m = src.match(/[?&]mid=([^&#\s]+)/);
  const mid = m ? m[1] : src;
  if (!/^[\w-]{10,}$/.test(mid)) throw new Error('看不懂這個網址，請貼含有 mid= 的我的地圖網址。');
  const res = UrlFetchApp.fetch('https://www.google.com/maps/d/kml?forcekml=1&mid=' + encodeURIComponent(mid), { muteHttpExceptions: true });
  const text = res.getContentText('UTF-8');
  if (res.getResponseCode() !== 200 || text.indexOf('<Placemark') < 0)
    throw new Error('下載不到點位，請確認地圖已開「知道連結的人可以檢視」。');
  props.setProperty('SOURCE', src);
  return text;
}

/** Google Map Tiles API session（快取 6 小時） */
function googleTiles_() {
  const key = props.getProperty('GOOGLE_MAPS_KEY');
  if (!key) return null;
  const hit = cache.get('gtiles');
  if (hit) return JSON.parse(hit);
  const specs = {
    roadmap: { mapType: 'roadmap', language: 'zh-TW', region: 'TW' },
    satellite: { mapType: 'satellite', language: 'zh-TW', region: 'TW' },
    terrain: { mapType: 'terrain', language: 'zh-TW', region: 'TW', layerTypes: ['layerRoadmap'] }
  };
  const sessions = {};
  Object.keys(specs).forEach(function (t) {
    try {
      const res = UrlFetchApp.fetch('https://tile.googleapis.com/v1/createSession?key=' + encodeURIComponent(key),
        { method: 'post', contentType: 'application/json', payload: JSON.stringify(specs[t]), muteHttpExceptions: true });
      if (res.getResponseCode() === 200) sessions[t] = JSON.parse(res.getContentText()).session;
      else console.warn('Map Tiles ' + t + '：' + res.getContentText().slice(0, 200));
    } catch (e) { console.warn(e); }
  });
  const out = { key: key, sessions: sessions };
  if (Object.keys(sessions).length) cache.put('gtiles', JSON.stringify(out), 21600);
  return out;
}
