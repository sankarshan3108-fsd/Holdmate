/**
 * Socket.IO: one room per booking ID ("booking:HM-1234").
 * Clients emit "track:join" with a booking ID; the server then pushes
 *   "vehicle:location" { bookingId, vehicle, lat, lng, speed, heading, at, eta }
 *   "booking:status"   { bookingId, status, statusHistory, eta }
 */
const { Server } = require('socket.io');
const { Booking } = require('../models');

let io = null;
const room = (bookingId) => `booking:${bookingId}`;
const ID_RE = /^HM-\d{4}$/;

function init(httpServer, corsOrigins) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    serveClient: true // the browser loads /socket.io/socket.io.js from this server
  });

  io.on('connection', (socket) => {
    socket.on('track:join', async (bookingId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const id = String(bookingId || '').toUpperCase();
        if (!ID_RE.test(id)) return reply({ ok: false, error: 'Invalid booking ID' });
        const exists = await Booking.exists({ bookingId: id });
        if (!exists) return reply({ ok: false, error: 'Booking not found' });
        // one tracked booking per socket
        for (const r of socket.rooms) if (r.startsWith('booking:')) socket.leave(r);
        socket.join(room(id));
        return reply({ ok: true });
      } catch (e) {
        return reply({ ok: false, error: 'Could not join tracking' });
      }
    });
    socket.on('track:leave', (bookingId) => socket.leave(room(String(bookingId || '').toUpperCase())));
  });
  return io;
}

function emitToBooking(bookingId, event, payload) {
  if (io) io.to(room(bookingId)).emit(event, payload);
}

module.exports = { init, emitToBooking };
