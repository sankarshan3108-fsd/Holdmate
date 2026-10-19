/**
 * Seed the database with test accounts, the fleet (with lockers) and demo booking HM-4821.
 * WARNING: clears the existing HoldMate collections first. Run with:  npm run seed
 */
const bcrypt = require('bcryptjs');
const env = require('./config/env');
env.assertRequired();

const { connectDB, disconnectDB } = require('./config/db');
const { User, Otp, Vehicle, Locker, Booking, LocationPing } = require('./models');
const { lockerLabels, newSealNumber } = require('./utils/ids');
const { toPoint } = require('./utils/geo');
const { calculateQuote } = require('./services/pricing.service');
const PLACES = require('./config/places');

const ACCOUNTS = {
  admin: { name: 'HoldMate Admin', phone: '9000000001', role: 'admin' },
  captainVan: { name: 'Captain R. Kumar', phone: '9000000002', role: 'captain' },
  captainSmall: { name: 'Captain S. Priya', phone: '9000000003', role: 'captain' },
  customer: { name: 'Demo Customer', phone: '9000000009', role: 'customer' }
};
const DEMO_OTP = '4821'; // handover OTP of the demo booking (printed below)

const place = (name) => {
  const p = PLACES.find((x) => x.name === name);
  return { name: p.name, lat: p.lat, lng: p.lng };
};

async function main() {
  await connectDB();
  console.log('[seed] clearing collections…');
  await Promise.all([User, Otp, Vehicle, Locker, Booking, LocationPing].map((M) => M.deleteMany({})));
  await Promise.all([User, Otp, Vehicle, Locker, Booking, LocationPing].map((M) => M.syncIndexes()));

  const users = {};
  for (const [key, data] of Object.entries(ACCOUNTS)) users[key] = await User.create(data);

  const fleet = [
    { code: 'HM-B4', type: 'bike', lockerCount: 2, captain: users.captainSmall._id, status: 'idle' },
    { code: 'HM-A2', type: 'auto', lockerCount: 8, captain: users.captainSmall._id, status: 'idle' },
    { code: 'HM-01', type: 'van', lockerCount: 20, captain: users.captainVan._id, status: 'active' },
    { code: 'HM-T1', type: 'truck', lockerCount: 48, captain: users.captainVan._id, status: 'idle' }
  ];
  const vehicles = {};
  for (const v of fleet) {
    vehicles[v.code] = await Vehicle.create(v);
    await Locker.insertMany(lockerLabels(v.lockerCount).map((label) => ({ vehicle: vehicles[v.code]._id, label })));
  }

  // Demo booking HM-4821: Coimbatore Junction → RS Puram, locker B3 on van HM-01, on the way
  const pickup = place('Coimbatore Junction');
  const drop = place('RS Puram');
  const van = vehicles['HM-01'];
  const quote = calculateQuote({ serviceType: 'standard', pickup, drop, hours: 4, bags: 2, weightKg: 18 });
  const locker = await Locker.findOne({ vehicle: van._id, label: 'B3' });
  const now = Date.now();
  const min = (m) => new Date(now - m * 60 * 1000);
  const booking = await Booking.create({
    bookingId: 'HM-4821',
    user: users.customer._id,
    serviceType: 'standard',
    pickup,
    drop,
    pickupTime: min(35),
    holdHours: 4,
    bags: 2,
    weightKg: 18,
    distanceKm: quote.distanceKm,
    price: quote.price,
    vehicle: van._id,
    locker: locker._id,
    sealNumber: newSealNumber(),
    otpHash: await bcrypt.hash(DEMO_OTP, 10),
    status: 'on_the_way',
    statusHistory: [
      { status: 'booked', at: min(90), by: users.customer._id },
      { status: 'picked_up', at: min(32), by: users.captainVan._id },
      { status: 'in_locker', at: min(30), by: users.captainVan._id },
      { status: 'on_the_way', at: min(8), by: users.captainVan._id }
    ],
    payment: { status: 'paid', method: 'upi', ref: 'DEMO-UPI-4821' }
  });
  locker.status = 'out_for_delivery';
  locker.booking = booking._id;
  await locker.save();

  // Van position part-way between the Junction and RS Puram
  const lat = pickup.lat + (drop.lat - pickup.lat) * 0.45;
  const lng = pickup.lng + (drop.lng - pickup.lng) * 0.45;
  van.currentLocation = toPoint(lat, lng);
  van.speed = 21;
  van.heading = 300;
  van.lastSeenAt = new Date();
  await van.save();
  await LocationPing.create({ vehicle: van._id, location: toPoint(lat, lng), speed: 21, heading: 300 });

  console.log('\n[seed] done.\n');
  console.log('  Test accounts (log in with phone + OTP; the OTP is printed in the server console in development):');
  console.table(Object.values(ACCOUNTS).map((a) => ({ role: a.role, name: a.name, phone: a.phone })));
  console.log('  Vehicles:');
  console.table(fleet.map((v) => ({ code: v.code, type: v.type, lockers: v.lockerCount, captain: v.captain.equals(users.captainVan._id) ? ACCOUNTS.captainVan.phone : ACCOUNTS.captainSmall.phone })));
  console.log(`  Demo booking: HM-4821 (Coimbatore Junction -> RS Puram, van HM-01, locker B3, on_the_way)`);
  console.log(`  Demo handover OTP: ${DEMO_OTP}\n`);
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
