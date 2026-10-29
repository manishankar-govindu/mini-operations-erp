import { badRequest } from './errors.js';

export function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be a positive integer`);
  return n;
}

export function requiredString(value, field, max = 150) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  if (value.length > max) throw badRequest(`${field} is too long`);
  return value.trim();
}

export function intId(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be a valid id`);
  return n;
}
