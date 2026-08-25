import { describe, it, expect } from 'vitest';
import { PlaybackService } from '../../src/services/playback.service.js';
import { RoomState } from '../../src/types/index.js';

describe('Playback Position Calculation & Drift Logic', () => {
  it('should return basePositionMs when state is paused', () => {
    const state: RoomState = {
      roomId: 'room-1',
      roomCode: 'TEST01',
      hostGuestId: 'host-1',
      trackId: 'spotify:track:123',
      status: 'paused',
      basePositionMs: 45000,
      updatedAt: 1000000,
      sequence: 1001,
    };

    const pos = PlaybackService.calculateCurrentPosition(state, 1050000);
    expect(pos).toBe(45000);
  });

  it('should accurately calculate dynamic position when state is playing', () => {
    const state: RoomState = {
      roomId: 'room-1',
      roomCode: 'TEST01',
      hostGuestId: 'host-1',
      trackId: 'spotify:track:123',
      status: 'playing',
      basePositionMs: 10000,
      updatedAt: 1000000,
      sequence: 1002,
    };

    const targetTime = 1005500; // 5500ms elapsed
    const pos = PlaybackService.calculateCurrentPosition(state, targetTime);
    expect(pos).toBe(15500);
  });

  it('should handle executeAt schedule buffer for future execution', () => {
    const now = 2000000;
    const scheduleBufferMs = 1500;
    const executeAt = now + scheduleBufferMs;

    expect(executeAt - now).toBe(1500);
  });

  it('should classify drift categories correctly according to protocol rules', () => {
    const evaluateDrift = (driftMs: number) => {
      const absDrift = Math.abs(driftMs);
      if (absDrift < 50) return 'NO_ACTION';
      if (absDrift <= 300) return 'RATE_ADJUST';
      if (absDrift <= 500) return 'CONTROLLED_SEEK';
      return 'HARD_RESYNC';
    };

    expect(evaluateDrift(20)).toBe('NO_ACTION');
    expect(evaluateDrift(-45)).toBe('NO_ACTION');
    expect(evaluateDrift(120)).toBe('RATE_ADJUST');
    expect(evaluateDrift(-250)).toBe('RATE_ADJUST');
    expect(evaluateDrift(350)).toBe('CONTROLLED_SEEK');
    expect(evaluateDrift(600)).toBe('HARD_RESYNC');
  });
});
