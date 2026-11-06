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

  const { people, price, label } = L.priceFor(plan);
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
      requestBody: { values: [[new Date().toISOString(), label, people, price, L.safeCell(name), L.safeCell(phone), L.safeCell(email), L.safeCell(note), L.safeCell(profile.name || ''), profile.userId, '已報名']] },
    });
  } catch (err) {
    console.error('[register] sheet', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  const pushed = await L.pushLine(profile.userId, [
    `${name} 你好，報名成功 ✅`,
    '',
    '【沖一杯，給自己的咖啡】',
    '順流人生學苑 × 鑠咖啡 Soul Coffee',
    '日期：2026/11/21（六）13:30–15:30',
    '地點：台北（詳細地址將於活動前通知）',
    `方案：${label}（${people} 位）`,
    `費用：NT$${price.toLocaleString('en-US')}`,
    '',
    '你的名額已為你保留，付款方式與行前資訊，主辦單位會再透過這個官方帳號通知你。',
    '期待在這個午後與你相遇 ☕',
  ].join('\n'));

  res.status(200).json({ result: 'success', pushed, plan: label, people, price });
};
