const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  if (!L.sameOrigin(req)) return res.status(403).json({ error: 'FORBIDDEN' });
  if (L.taipeiToday() > L.EVENT_DATE) return res.status(400).json({ error: 'EVENT_ENDED' });

  let plan, name, phone, email, note, idToken;
  try {
    const b = req.body || {};
    plan = b.plan === 'duo' ? 'duo' : 'single';
    name = L.text(b.name, 40, true); phone = L.text(b.phone, 25, true);
    email = L.text(b.email, 100); note = L.text(b.note, 300); idToken = L.text(b.lineIdToken, 4096, true);
    if (!/^[0-9+\-()\s]{8,25}$/.test(phone)) throw new Error('INVALID_INPUT');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_INPUT');
  } catch {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const profile = await L.verifyLineIdToken(idToken);
  if (!profile) return res.status(401).json({ error: 'INVALID_LINE_LOGIN' });
  if (!(await L.isFriend(profile.userId))) return res.status(403).json({ error: 'NOT_FRIEND' });

  const { people, price, label, early } = L.priceFor(plan);
  try {
    const sheets = L.sheetsClient();
    const rows = await L.readRows(sheets);

    // 同一個 LINE 帳號只能報名一次；重送不重複寫入、不重複推播
    if (rows.some(r => r[9] === profile.userId && r[10] !== '已取消')) return res.status(200).json({ result: 'success', duplicate: true });

    if (L.CAPACITY - L.seatsTaken(rows) < people) return res.status(409).json({ error: 'FULL' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: `${L.SHEET_NAME}!A:K`,
      valueInputOption: 'RAW',
      requestBody: { values: [[new Date().toISOString(), label, people, price, L.safeCell(name), L.safeCell(phone), L.safeCell(email), L.safeCell(note), L.safeCell(profile.name || ''), profile.userId, '待匯款']] },
    });
  } catch (err) {
    console.error('[register] sheet', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  const pushed = await L.pushLine(profile.userId, [
    '【沖一杯，給自己的咖啡】名額已為你保留',
    '',
    `${name} 你好，`,
    '我們已收到你的報名資料，名額先為你保留。',
    '完成匯款後，報名才正式成立。',
    '',
    '▍活動資訊',
    '日期：2026/11/21（六）13:30–15:30',
    '地點：台北（詳細地址將於活動前通知）',
    '主辦：順流人生學苑 × 鑠咖啡 Soul Coffee',
    '',
    '▍你的方案',
    `${label}（${people} 位）`,
    `費用：NT$${price.toLocaleString('en-US')}`,
    '',
    '▍匯款資訊',
    '銀行：中國信託（822）',
    '帳號：716540100424',
    early ? '早鳥價請於 11/14（六）23:59 前完成匯款。' : '請儘早完成匯款，我們才能為你確認名額。',
    '匯款後，請直接在此官方 LINE 回覆「匯款帳號末五碼」，我們核對後會通知你報名成功。',
    '',
    '期待在這個午後與你相遇 ☕',
  ].join('\n'));

  res.status(200).json({ result: 'success', pushed, plan: label, people, price, early });
};
