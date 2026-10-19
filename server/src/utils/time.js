/** Start/end of a calendar day in India Standard Time (UTC+5:30), returned as UTC Dates. */
const IST_OFFSET_MS = 330 * 60 * 1000;

function istDayRange(dateStr) {
  // dateStr: 'YYYY-MM-DD' (optional → today in IST)
  let y, m, d;
  if (dateStr) {
    [y, m, d] = dateStr.split('-').map(Number);
  } else {
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    y = nowIst.getUTCFullYear(); m = nowIst.getUTCMonth() + 1; d = nowIst.getUTCDate();
  }
  const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
module.exports = { istDayRange };
