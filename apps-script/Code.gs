/**
 * 邊坡圖資編號查詢：後台 API（Google Apps Script）
 * 前台在 GitHub Pages，使用者用 Google 帳號登入，前台把登入憑證送來這裡驗證。
 *
 * 權限：看試算表「邊坡圖資權限」（第一次使用自動建立）
 *   - A 欄帳號、B 欄「查看」或「編輯」、C 欄備註
 *   - 查看 → 可以查詢；編輯 → 可以更換圖資、管理權限
 *   - 部署者本人永遠是編輯；不在表上的帳號 → 拒絕
 *   - 也可以在網頁的「權限管理」直接新增、修改、刪除
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
  Logger.log('權限表：' + aclSheet_().getParent().getUrl());
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
    if (!role) { log_(email, '拒絕（無權限）', req.ua); return json_({ error: 'NO_ACCESS', email: email, message: email + ' 沒有使用權限，請聯絡管理員。' }); }
    const needEdit = () => { if (role !== 'edit') throw new Error('你只有查看權限，不能更換圖資。'); };
    switch (req.action) {
      case 'get': log_(email, req.fresh ? '登入' : '開啟', req.ua); return json_(getData_(email, role));
      case 'logList': if (email !== owner_()) throw new Error('只有擁有者可以查看登入紀錄。'); return json_(logList_());
      case 'save': needEdit(); return json_(saveData_(req.data));
      case 'fetchMyMaps': needEdit(); return json_({ kml: fetchMyMaps_(req.url) });
      case 'aclList': needEdit(); return json_(aclList_());
      case 'aclSet': needEdit(); if (String(req.email).toLowerCase() === email && req.role !== 'edit') throw new Error('不能降低自己的權限。'); return json_(aclSet_(req.email, req.role, req.note));
      case 'aclRemove': needEdit(); return json_(aclRemove_(req.email, email));
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

const ACL_NAME = '邊坡圖資權限';
const ROLE_LABEL = { view: '查看', edit: '編輯' };

function owner_() { return String(Session.getEffectiveUser().getEmail()).toLowerCase(); }

/** 權限試算表（沒有就建立） */
function aclSheet_() {
  let id = props.getProperty('ACL_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) {}
  }
  const ss = SpreadsheetApp.create(ACL_NAME);
  const sh = ss.getSheets()[0];
  sh.setName('權限');
  sh.getRange(1, 1, 1, 3).setValues([['帳號', '權限', '備註']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 260); sh.setColumnWidth(3, 240);
  sh.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['查看', '編輯'], true).build());
  sh.appendRow([owner_(), '編輯', '擁有者']);
  props.setProperty('ACL_ID', ss.getId());
  return sh;
}

/** 讀出全部權限（快取 5 分鐘） */
function aclRows_() {
  const hit = cache.get('acl2');
  if (hit) return JSON.parse(hit);
  const sh = aclSheet_();
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
  const out = rows
    .map(r => ({ email: String(r[0]).trim().toLowerCase(), role: String(r[1]).trim() === '編輯' ? 'edit' : (String(r[1]).trim() === '查看' ? 'view' : ''), note: String(r[2] || '') }))
    .filter(r => r.email && r.role);
  cache.put('acl2', JSON.stringify(out), 300);
  return out;
}

function role_(email) {
  if (email === owner_()) return 'edit';
  const r = aclRows_().find(x => x.email === email);
  return r ? r.role : null;
}

function aclList_() {
  const sh = aclSheet_();
  return { owner: owner_(), rows: aclRows_(), sheetUrl: sh.getParent().getUrl() };
}

function aclSet_(email, role, note) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('帳號格式不對，請輸入完整的 email。');
  if (role !== 'view' && role !== 'edit') throw new Error('權限只能是查看或編輯。');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = aclSheet_();
    const n = sh.getLastRow() - 1;
    const emails = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
    const i = emails.indexOf(email);
    if (i >= 0) {
      sh.getRange(i + 2, 2).setValue(ROLE_LABEL[role]);
      if (note !== undefined) sh.getRange(i + 2, 3).setValue(note);
    } else {
      sh.appendRow([email, ROLE_LABEL[role], note || '']);
    }
  } finally { lock.releaseLock(); cache.remove('acl2'); }
  return aclList_();
}

function aclRemove_(email, me) {
  email = String(email || '').trim().toLowerCase();
  if (email === owner_()) throw new Error('擁有者不能移除。');
  if (email === me) throw new Error('不能移除自己的權限。');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = aclSheet_();
    const n = sh.getLastRow() - 1;
    const emails = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
    for (let i = emails.length - 1; i >= 0; i--) if (emails[i] === email) sh.deleteRow(i + 2);
  } finally { lock.releaseLock(); cache.remove('acl2'); }
  return aclList_();
}

/** 在試算表手動改完想立刻生效，可在編輯器執行這個 */
function clearAccessCache() { cache.remove('acl2'); }

function getData_(email, role) {
  const f = file_();
  return {
    email: email,
    canEdit: role === 'edit',
    isOwner: email === owner_(),
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

/** 登入紀錄：存在權限試算表的「登入紀錄」工作表，只有擁有者看得到 */
const LOG_MAX = 5000;
function logSheet_() {
  const ss = aclSheet_().getParent();
  let sh = ss.getSheetByName('登入紀錄');
  if (!sh) {
    sh = ss.insertSheet('登入紀錄');
    sh.getRange(1, 1, 1, 4).setValues([['時間', '帳號', '動作', '裝置']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 240); sh.setColumnWidth(4, 200);
  }
  return sh;
}

function log_(email, action, ua) {
  try {
    const sh = logSheet_();
    sh.appendRow([new Date(), email, action, String(ua || '').slice(0, 100)]);
    const extra = sh.getLastRow() - 1 - LOG_MAX;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { console.warn('log failed', e); }
}

function logList_() {
  const sh = logSheet_();
  const n = sh.getLastRow() - 1;
  const take = Math.min(n, 300);
  const rows = take > 0 ? sh.getRange(n - take + 2, 1, take, 4).getValues() : [];
  return {
    sheetUrl: sh.getParent().getUrl() + '#gid=' + sh.getSheetId(),
    total: Math.max(n, 0),
    rows: rows.reverse().map(r => ({ t: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), email: r[1], action: r[2], ua: r[3] }))
  };
}
