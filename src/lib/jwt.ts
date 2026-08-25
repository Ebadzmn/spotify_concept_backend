import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { GuestJwtPayload } from '../types/index.js';

export function signGuestToken(payload: { guestId: string; displayName?: string | null }): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyGuestToken(token: string): GuestJwtPayload {
  return jwt.verify(token, config.JWT_SECRET) as GuestJwtPayload;
}
