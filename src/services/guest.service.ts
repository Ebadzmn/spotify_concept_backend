import { prisma } from '../lib/prisma.js';
import { signGuestToken } from '../lib/jwt.js';
import { GuestSession } from '../types/index.js';

export class GuestService {
  /**
   * Get or create guest identity based on UUID v4 provided by client
   */
  static async getOrCreateGuest(guestId: string, displayName?: string | null): Promise<{ guest: GuestSession; token: string }> {
    const guest = await prisma.guest.upsert({
      where: { guestId },
      update: {
        lastSeenAt: new Date(),
        ...(displayName ? { displayName } : {}),
      },
      create: {
        guestId,
        displayName: displayName || null,
      },
    });

    const token = signGuestToken({
      guestId: guest.guestId,
      displayName: guest.displayName,
    });

    return {
      guest: {
        id: guest.id,
        guestId: guest.guestId,
        displayName: guest.displayName,
      },
      token,
    };
  }

  static async findByGuestId(guestId: string): Promise<GuestSession | null> {
    const guest = await prisma.guest.findUnique({
      where: { guestId },
    });
    if (!guest) return null;
    return {
      id: guest.id,
      guestId: guest.guestId,
      displayName: guest.displayName,
    };
  }
}
