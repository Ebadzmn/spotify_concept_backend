import { Router, Request, Response, NextFunction } from 'express';
import { GuestService } from '../services/guest.service.js';
import { createGuestSessionSchema } from '../validators/index.js';

export const authRouter = Router();

/**
 * POST /api/auth/guest-session
 * Initialize or resume a guest session and obtain a signed JWT.
 */
authRouter.post('/guest-session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { guestId, displayName } = createGuestSessionSchema.parse(req.body);
    const { guest, token } = await GuestService.getOrCreateGuest(guestId, displayName);

    res.status(200).json({
      success: true,
      guest,
      token,
    });
  } catch (err) {
    next(err);
  }
});
