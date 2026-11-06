const { CAPACITY, sheetsClient, readRows, seatsTaken } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const left = Math.max(0, CAPACITY - seatsTaken(await readRows(sheetsClient())));
    res.status(200).json({ capacity: CAPACITY, left });
  } catch (err) {
    console.error('[status]', err.message);
    res.status(500).json({ error: 'STATUS_UNAVAILABLE' });
  }
};
