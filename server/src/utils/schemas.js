/**
 * Reusable zod schemas.
 */
const { z } = require('zod');
const { LIMITS } = require('../config/pricing');

/** Indian mobile: accepts "98765 43210", "+91 9876543210", "09876543210"; normalises to 10 digits. */
const phone = z
  .string({ required_error: 'Phone number is required' })
  .transform((v) => v.replace(/[\s\-()]/g, ''))
  .transform((v) => v.replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), { message: 'Enter a valid 10-digit Indian mobile number' });

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const point = z.object({ lat, lng, name: z.string().trim().max(160).optional() }).strict();
const place = z.object({ name: z.string().trim().min(1, 'Place name is required').max(160), lat, lng }).strict();

const serviceType = z.enum(['standard', 'scheduled', 'express', 'store', 'events']);
const hours = z.coerce.number().int().min(LIMITS.minHours).max(LIMITS.maxHours);
const bags = z.coerce.number().int().min(1).max(LIMITS.maxBags);
const weightKg = z.coerce.number().min(1).max(LIMITS.maxWeightKg);

const bookingIdParam = z.object({
  id: z.string().trim().toUpperCase().regex(/^HM-\d{4}$/, 'Booking IDs look like HM-1234')
});
const bookingIdParamAlt = z.object({
  bookingId: z.string().trim().toUpperCase().regex(/^HM-\d{4}$/, 'Booking IDs look like HM-1234')
});
/** A vehicle can be referenced by its Mongo id or its code (e.g. HM-01). */
const vehicleRef = z.string().trim().min(1).max(40);
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

module.exports = { z, phone, lat, lng, point, place, serviceType, hours, bags, weightKg, bookingIdParam, bookingIdParamAlt, vehicleRef, objectId };
