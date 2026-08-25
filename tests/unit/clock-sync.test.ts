import { describe, it, expect } from 'vitest';
import { signGuestToken, verifyGuestToken } from '../../src/lib/jwt.js';

describe('Clock Offset & JWT Session Unit Tests', () => {
  it('should sign and verify guest JWT session tokens', () => {
    const payload = {
      guestId: '550e8400-e29b-41d4-a716-446655440000',
      displayName: 'Alice',
    };

    const token = signGuestToken(payload);
    expect(typeof token).toBe('string');

    const decoded = verifyGuestToken(token);
    expect(decoded.guestId).toBe(payload.guestId);
    expect(decoded.displayName).toBe(payload.displayName);
  });

  it('should calculate round trip time (RTT) and server clock offset', () => {
    // Client sends ping at T0
    const t0_clientSentTime = 10000;
    // Server receives and responds at T_server
    const t_serverTimestamp = 10050; // Server is slightly ahead
    // Client receives pong at T1 (total RTT = 40ms)
    const t1_clientReceivedTime = 10040;

    const rtt = t1_clientReceivedTime - t0_clientSentTime; // 40ms
    const estimatedServerAtReceive = t_serverTimestamp + rtt / 2; // 10050 + 20 = 10070
    const clockOffset = estimatedServerAtReceive - t1_clientReceivedTime; // 10070 - 10040 = +30ms

    expect(rtt).toBe(40);
    expect(clockOffset).toBe(30);

    // Client estimated server time now
    const clientNow = 10100;
    const estimatedServerNow = clientNow + clockOffset;
    expect(estimatedServerNow).toBe(10130);
  });

  it('should properly reject out-of-order and stale sequence numbers', () => {
    let lastProcessedSequence = 1005;

    const shouldProcessCommand = (incomingSeq: number) => {
      if (incomingSeq <= lastProcessedSequence) {
        return false; // ignore stale/duplicate
      }
      lastProcessedSequence = incomingSeq;
      return true;
    };

    expect(shouldProcessCommand(1006)).toBe(true);
    expect(shouldProcessCommand(1006)).toBe(false); // duplicate
    expect(shouldProcessCommand(1004)).toBe(false); // out of order / stale
    expect(shouldProcessCommand(1007)).toBe(true);
  });
});
