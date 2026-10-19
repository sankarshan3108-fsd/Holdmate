/**
 * JWT auth (httpOnly cookie, or "Authorization: Bearer <token>" for tools/apps)
 * and role-based access control (customer / captain / admin).
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { User } = require('../models');

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function tokenFrom(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return readCookie(req, env.COOKIE_NAME);
}

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function setAuthCookie(res, user) {
  res.cookie(env.COOKIE_NAME, signToken(user), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(env.COOKIE_NAME, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/' });
}

/** Requires a valid session; loads the user fresh from the DB (so role changes apply immediately). */
async function requireAuth(req, res, next) {
  try {
    const token = tokenFrom(req);
    if (!token) throw new AppError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (e) {
      clearAuthCookie(res);
      throw new AppError(401, 'Your session has expired. Please log in again.', 'SESSION_EXPIRED');
    }
    const user = await User.findById(payload.sub);
    if (!user) {
      clearAuthCookie(res);
      throw new AppError(401, 'Account not found. Please log in again.', 'UNAUTHENTICATED');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Loads the user if a valid session exists; never fails (used by GET /api/auth/me). */
async function optionalAuth(req, res, next) {
  try {
    const token = tokenFrom(req);
    if (token) {
      try {
        const payload = jwt.verify(token, env.JWT_SECRET);
        req.user = await User.findById(payload.sub);
      } catch (e) {
        clearAuthCookie(res);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Use after requireAuth: requireRole('captain', 'admin') */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError(401, 'Please log in to continue.', 'UNAUTHENTICATED'));
  if (!roles.includes(req.user.role)) return next(new AppError(403, 'You do not have permission to do this.', 'FORBIDDEN'));
  next();
};

module.exports = { requireAuth, optionalAuth, requireRole, setAuthCookie, clearAuthCookie, signToken };
