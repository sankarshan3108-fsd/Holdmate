const env = require('../config/env');
const { ROAD_FACTOR } = require('../config/pricing');

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km between {lat,lng} points. */
function haversine(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const roadKm = (a, b) => haversine(a, b) * ROAD_FACTOR;
const kmFromHub = (p) => haversine(env.HUB, p);
const inZone = (p) => kmFromHub(p) <= env.SERVICE_RADIUS_KM;
const round1 = (n) => Math.round(n * 10) / 10;

/** GeoJSON helpers (GeoJSON stores [lng, lat]). */
const toPoint = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });
const fromPoint = (pt) => (pt && Array.isArray(pt.coordinates) && pt.coordinates.length === 2 ? { lat: pt.coordinates[1], lng: pt.coordinates[0] } : null);

module.exports = { haversine, roadKm, kmFromHub, inZone, round1, toPoint, fromPoint };
