import { Request, Response, NextFunction } from 'express';
import { verifyGuestToken } from '../lib/jwt.js';
import { GuestSession } from '../types/index.js';
import { prisma } from '../lib/prisma.js';

export interface AuthenticatedRequest extends Request {
  guest?: GuestSession;
}

export async function requireGuestAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header. Expected Bearer token.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyGuestToken(token);
    const guest = await prisma.guest.findUnique({
      where: { guestId: payload.guestId },
    });

    if (!guest) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Guest session not found or invalid.',
      });
      return;
    }

    req.guest = {
      id: guest.id,
      guestId: guest.guestId,
      displayName: guest.displayName,
    };
    next();
  } catch (err) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired guest session token.',
    });
  }
}
