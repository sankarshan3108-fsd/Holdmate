const crypto = require('crypto');

/** n random digits (cryptographically secure), may start with any digit except when noLeadingZero. */
function randomDigits(n, noLeadingZero = true) {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10);
  if (noLeadingZero && s[0] === '0') s = String(crypto.randomInt(1, 10)) + s.slice(1);
  return s;
}
const newBookingId = () => `HM-${randomDigits(4)}`;
const newSealNumber = () => `#HM-${randomDigits(5)}`;

/** Locker labels: rows A, B, C… with 2/4/5/8 columns depending on size (A1–D5 for 20). */
function lockerLabels(count) {
  const cols = count <= 2 ? count : count <= 8 ? 4 : count <= 20 ? 5 : 8;
  const labels = [];
  for (let i = 0; i < count; i++) labels.push(String.fromCharCode(65 + Math.floor(i / cols)) + ((i % cols) + 1));
  return labels;
}
/** Sort A1, A2 … B1 naturally. */
const byLabel = (a, b) => (a.label[0] === b.label[0] ? parseInt(a.label.slice(1), 10) - parseInt(b.label.slice(1), 10) : a.label.localeCompare(b.label));

module.exports = { randomDigits, newBookingId, newSealNumber, lockerLabels, byLabel };
