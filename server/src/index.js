/**
 * HoldMate API server: Express + Socket.IO + MongoDB.
 * Also serves the frontend (index.html, css/, js/) so everything runs at http://localhost:5000
 */
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const env = require('./config/env');
env.assertRequired();

const { connectDB } = require('./config/db');
const routes = require('./routes');
const realtime = require('./services/realtime');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // correct client IPs behind a proxy/load balancer (rate limiting)

/* ---------- Security headers (CSP allows only the CDNs/APIs the frontend uses) ---------- */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com'],
        'connect-src': ["'self'", 'https://nominatim.openstreetmap.org', 'https://router.project-osrm.org', ...(env.isDev ? [`ws://localhost:${env.PORT}`, `ws://127.0.0.1:${env.PORT}`] : [])],
        'upgrade-insecure-requests': env.isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
  })
);

/* ---------- CORS (only needed when the frontend runs on another origin, e.g. Live Server) ---------- */
const allowedOrigins = new Set([`http://localhost:${env.PORT}`, `http://127.0.0.1:${env.PORT}`, ...env.CORS_ORIGINS]);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(morgan(env.isProd ? 'combined' : 'dev', { skip: (req) => !req.originalUrl.startsWith('/api') }));

/* ---------- API ---------- */
app.use('/api', apiLimiter, routes);
app.use('/api', notFound);

/* ---------- Frontend (only these folders are public; server/ and .env are never served) ---------- */
const ROOT = path.resolve(__dirname, '..', '..');
const staticOpts = { maxAge: env.isProd ? '1d' : 0, index: false, dotfiles: 'ignore' };
app.use('/css', express.static(path.join(ROOT, 'css'), staticOpts));
app.use('/js', express.static(path.join(ROOT, 'js'), staticOpts));
app.use('/assets', express.static(path.join(ROOT, 'assets'), staticOpts));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(errorHandler);

/* ---------- Start ---------- */
const server = http.createServer(app);
realtime.init(server, [...allowedOrigins]);

connectDB().then(() => {
  server.listen(env.PORT, () => {
    console.log(`[server] HoldMate running at http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`[server] Port ${env.PORT} is already in use. Stop the other process or change PORT in server/.env.`);
  else console.error('[server]', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

module.exports = { app, server };
