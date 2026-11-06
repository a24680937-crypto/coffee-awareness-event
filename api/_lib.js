const { google } = require('googleapis');

const SHEET_NAME = '咖啡活動報名';
const HEADER = ['報名時間', '方案', '人數', '費用', '姓名', '電話', 'Email', '備註', 'LINE 名稱', 'LINE userId', '狀態'];
const CAPACITY = 12;
const EVENT_DATE = '2026-11-21';
const EARLY_END = '2026-11-14';

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

// 價格一律由伺服器依日期決定，不信任前端傳來的金額
function priceFor(plan) {
  if (plan === 'duo') return { people: 2, price: 2800, label: '兩人同行' };
  const early = taipeiToday() <= EARLY_END;
  return { people: 1, price: early ? 1280 : 1680, label: early ? '單人早鳥' : '單人原價' };
}

function text(v, max, required) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new Error('INVALID_INPUT');
  if (s.length > max) throw new Error('INVALID_INPUT');
  return s;
}

// 避免試算表把使用者輸入當公式執行
function safeCell(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === 'coffee-awareness-event.vercel.app';
  } catch { return false; }
}

function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheet(sheets) {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  if (meta.data.sheets.some(s => s.properties.title === SHEET_NAME)) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] } });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id, range: `${SHEET_NAME}!A1:K1`, valueInputOption: 'RAW', requestBody: { values: [HEADER] },
  });
}

async function readRows(sheets) {
  await ensureSheet(sheets);
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID, range: `${SHEET_NAME}!A2:K` });
  return r.data.values || [];
}

// 已取消的報名不佔名額
function seatsTaken(rows) {
  return rows.filter(r => r[10] !== '已取消').reduce((n, r) => n + (Number(r[2]) || 0), 0);
}

async function verifyLineIdToken(idToken) {
  const resp = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: process.env.LINE_LOGIN_CHANNEL_ID }),
  });
  if (!resp.ok) return null;
  const d = await resp.json();
  return { userId: d.sub, name: d.name };
}

// 查得到該 userId 的個人資料 = 已加官方帳號為好友且沒封鎖；404 = 未加或已封鎖
async function isFriend(userId) {
  const resp = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}` },
  });
  await resp.text();
  return resp.ok;
}

async function pushLine(userId, message) {
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] }),
  });
  const body = await resp.text();
  if (!resp.ok) console.error('[pushLine] failed', resp.status, body);
  return resp.ok;
}

module.exports = { CAPACITY, EVENT_DATE, taipeiToday, priceFor, text, safeCell, sameOrigin, sheetsClient, ensureSheet, readRows, seatsTaken, verifyLineIdToken, isFriend, pushLine, SHEET_NAME };
