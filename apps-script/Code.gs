/**
 * 邊坡圖資編號查詢（Google Apps Script 網頁應用程式）
 *
 * 權限：完全交給 Google 雲端硬碟的共用設定
 *   - 圖資檔「邊坡圖資資料.json」共用為「檢視者」→ 可以查詢
 *   - 共用為「編輯者」→ 可以更換圖資
 *   - 沒有被共用的帳號打開網頁只會看到「沒有權限」
 *
 * 部署設定：執行身分「存取網頁應用程式的使用者」，存取權「任何擁有 Google 帳戶的使用者」
 * 第一次使用：在編輯器選擇 setup 函式按「執行」一次。
 *
 * Google 底圖（選用）：到 Google Cloud 啟用 Map Tiles API、建立 API 金鑰，
 * 在「專案設定 → 指令碼屬性」新增 GOOGLE_MAPS_KEY = 你的金鑰。沒設定就不會出現 Google 底圖。
 */

const DATA_FILE_NAME = '邊坡圖資資料.json';
const DEFAULT_SOURCE = 'https://www.google.com/maps/d/viewer?mid=1sAfTasaC9TFY6UplMoaOUziEq9VAL78';
const props = PropertiesService.getScriptProperties();

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('邊坡圖資編號查詢')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 只需要擁有者在編輯器執行一次：建立圖資檔並記下檔案 ID */
function setup() {
  let id = props.getProperty('FILE_ID');
  if (id) {
    Logger.log('已經設定過，圖資檔：' + DriveApp.getFileById(id).getUrl());
    return;
  }
  const file = DriveApp.createFile(DATA_FILE_NAME, '', 'application/json');
  props.setProperty('FILE_ID', file.getId());
  props.setProperty('SOURCE', DEFAULT_SOURCE);
  Logger.log('圖資檔已建立：' + file.getUrl());
  Logger.log('請到雲端硬碟把這個檔案共用給要使用的人（檢視者＝可查詢，編輯者＝可更換圖資）');
}

function fileId_() {
  const id = props.getProperty('FILE_ID');
  if (!id) throw new Error('系統尚未設定，請管理員先在編輯器執行 setup。');
  return id;
}

function openFile_() {
  try {
    return DriveApp.getFileById(fileId_());
  } catch (e) {
    if (String(e).indexOf('尚未設定') >= 0) throw e;
    const who = Session.getActiveUser().getEmail() || '目前的帳號';
    throw new Error(who + ' 沒有查看權限，請聯絡管理員把圖資檔共用給你。');
  }
}

function canEdit_() {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId_() + '?fields=capabilities(canEdit)&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  return !!JSON.parse(res.getContentText()).capabilities.canEdit;
}

/** 前端讀取圖資 */
function getData() {
  const file = openFile_();
  const editable = canEdit_();
  return {
    data: file.getBlob().getDataAsString('UTF-8') || null,
    updated: file.getLastUpdated().toISOString(),
    canEdit: editable,
    source: editable ? (props.getProperty('SOURCE') || DEFAULT_SOURCE) : '',
    google: googleTiles_()
  };
}

/** 前端解析完 KML 後，把精簡過的資料存回雲端硬碟 */
function saveData(json) {
  const file = openFile_();
  if (!canEdit_()) throw new Error('你只有查看權限，不能更換圖資。');
  const obj = JSON.parse(json);
  if (!obj || !Array.isArray(obj.points) || !obj.points.length) throw new Error('圖資內容是空的。');
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + file.getId() + '?uploadType=media&supportsAllDrives=true',
    { method: 'patch', contentType: 'application/json', payload: json,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('存檔失敗：' + res.getContentText().slice(0, 200));
  return { updated: new Date().toISOString() };
}

/** 從我的地圖下載整份 KML（地圖需開「知道連結的人可以檢視」） */
function fetchMyMaps(url) {
  if (!canEdit_()) throw new Error('你只有查看權限，不能更換圖資。');
  const src = String(url || props.getProperty('SOURCE') || DEFAULT_SOURCE).trim();
  const m = src.match(/[?&]mid=([^&#\s]+)/);
  const mid = m ? m[1] : src;
  if (!/^[\w-]{10,}$/.test(mid)) throw new Error('看不懂這個網址，請貼含有 mid= 的我的地圖網址。');
  const res = UrlFetchApp.fetch('https://www.google.com/maps/d/kml?forcekml=1&mid=' + encodeURIComponent(mid),
    { muteHttpExceptions: true, followRedirects: true });
  const text = res.getContentText('UTF-8');
  if (res.getResponseCode() !== 200 || text.indexOf('<Placemark') < 0)
    throw new Error('下載不到點位，請確認地圖已開「知道連結的人可以檢視」。');
  props.setProperty('SOURCE', src);
  return text;
}

/** 建立 Google Map Tiles API 的 session（快取 6 小時） */
function googleTiles_() {
  const key = props.getProperty('GOOGLE_MAPS_KEY');
  if (!key) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('gtiles');
  if (hit) return JSON.parse(hit);
  const sessions = {};
  const specs = {
    roadmap: { mapType: 'roadmap', language: 'zh-TW', region: 'TW' },
    satellite: { mapType: 'satellite', language: 'zh-TW', region: 'TW' },
    terrain: { mapType: 'terrain', language: 'zh-TW', region: 'TW', layerTypes: ['layerRoadmap'] }
  };
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
