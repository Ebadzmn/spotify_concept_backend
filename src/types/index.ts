export type PlaybackStatus = 'playing' | 'paused' | 'loading' | 'transitioning';

export type CommandType = 'PLAY' | 'PAUSE' | 'SEEK' | 'NEXT' | 'PREVIOUS' | 'TRACK_CHANGE' | 'SYNC';

export interface GuestSession {
  id: string;
  guestId: string;
  displayName: string | null;
}

export interface GuestJwtPayload {
  guestId: string;
  displayName?: string | null;
  iat?: number;
  exp?: number;
}

export interface RoomState {
  roomId: string;
  roomCode: string;
  hostGuestId: string;
  trackId: string | null;
  status: PlaybackStatus;
  basePositionMs: number;
  updatedAt: number; // Server epoch ms
  sequence: number;
  membersCount?: number;
}

export interface PlaybackCommand {
  commandId: string;
  sequence: number;
  type: CommandType;
  trackId: string | null;
  positionMs: number;
  executeAt: number; // Server epoch ms
  issuedAt: number;
  playbackRate?: number;
}

export interface SyncStatePayload {
  type: 'SYNC';
  roomId: string;
  trackId: string | null;
  status: PlaybackStatus;
  positionMs: number;
  serverTimestamp: number;
  sequence: number;
}

export interface ClockPingPayload {
  clientSentTime: number;
}

export interface ClockPongPayload {
  clientSentTime: number;
  serverTimestamp: number;
}

export interface CommandReceivedAck {
  commandId: string;
  guestId: string;
}

export interface CommandExecutedAck {
  commandId: string;
  guestId: string;
  actualPositionMs: number;
}

export interface SyncHealthPayload {
  rttMs: number;
  jitterMs: number;
  spotifyReady: boolean;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_ROOM_MEMBER'
  | 'NOT_ROOM_HOST'
  | 'INVALID_COMMAND'
  | 'INVALID_TRACK'
  | 'COMMAND_EXPIRED'
  | 'UNAUTHORIZED'
  | 'INVALID_SEQUENCE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface SocketErrorResponse {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

// Client to Server Events
export interface ClientToServerEvents {
  'clock:ping': (data: ClockPingPayload) => void;
  'room:join': (data: { roomCode: string }, callback?: (response: { success: boolean; error?: SocketErrorResponse }) => void) => void;
  'room:leave': (data: { roomCode: string }, callback?: (response: { success: boolean }) => void) => void;
  'room:resync': (data: { roomCode: string }, callback?: (response: { success: boolean; data?: SyncStatePayload; error?: SocketErrorResponse }) => void) => void;
  'player:play': (data: { roomCode: string; trackId?: string; positionMs?: number }) => void;
  'player:pause': (data: { roomCode: string; positionMs?: number }) => void;
  'player:seek': (data: { roomCode: string; positionMs: number }) => void;
  'player:next': (data: { roomCode: string; trackId: string }) => void;
  'player:previous': (data: { roomCode: string; trackId: string }) => void;
  'command:received': (data: CommandReceivedAck) => void;
  'command:executed': (data: CommandExecutedAck) => void;
  'sync:health': (data: SyncHealthPayload) => void;
  'track:prepare': (data: { roomCode: string; trackId: string }) => void;
  'track:ready': (data: { roomCode: string; trackId: string }) => void;
}

// Server to Client Events
export interface ServerToClientEvents {
  'clock:pong': (data: ClockPongPayload) => void;
  'room:joined': (data: { guestId: string; displayName: string | null; membersCount: number }) => void;
  'room:left': (data: { guestId: string; membersCount: number }) => void;
  'room:state': (data: RoomState) => void;
  'room:host_changed': (data: { newHostGuestId: string }) => void;
  'player:command': (data: PlaybackCommand) => void;
  'player:sync': (data: SyncStatePayload) => void;
  'track:prepare': (data: { trackId: string }) => void;
  'track:readiness': (data: { guestId: string; trackId: string; ready: boolean }) => void;
  'error': (data: SocketErrorResponse) => void;
}

export interface SocketData {
  guest: GuestSession;
  currentRoomCode?: string;
  syncHealth?: SyncHealthPayload;
}
