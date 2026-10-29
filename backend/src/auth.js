import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, forbidden } from './errors.js';

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OPERATIONS: 'operations_user',
  SALES: 'sales_user',
});

export async function login(username, password) {
  const { rows } = await pool.query(
    'SELECT id, username, full_name, role, password_hash FROM users WHERE username = $1', [username]);
  const user = rows[0];
  // Same message for unknown user and wrong password, to avoid user enumeration.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid username or password');
  }
  const payload = { sub: user.id, username: user.username, role: user.role };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } };
}

/** Verifies the Bearer token and attaches req.user. */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    req.user = { id: claims.sub, username: claims.username, role: claims.role };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

/** Backend role check. Must be used after authenticate. */
export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(forbidden(`Role '${req.user.role}' is not allowed to perform this action`));
  }
  next();
};
