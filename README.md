# Spotify Synchronized Listening Room Backend

A production-ready, ultra-low latency, highly synchronized music room backend built with **Node.js, Express.js, TypeScript, Socket.IO, Redis, and PostgreSQL (Prisma ORM)**.

> **CRITICAL ARCHITECTURE NOTE**: The backend **never** streams, proxies, or processes Spotify audio. Client applications stream playback directly via the local Spotify SDK. The backend provides authoritative room management, guest identity sessions, clock synchronization, future-scheduled playback events, sequence ordering, periodic drift correction, and reconnection state hydration.

---

## Architecture Overview

```
                      PostgreSQL
                    Users / Rooms
                          ▲
                          │
                    Express.js API
                          │
                   Socket.IO Server
                          │
                        Redis
                 Room State / PubSub
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           Guest A     Guest B     Guest C
            HOST        MEMBER       MEMBER
              │           │           │
              └────── Spotify SDK ────┘
```

---

## Core Features & Mechanics

1. **Passwordless Guest Identity**:
   - Client generates a UUID v4 `guestId` on first launch.
   - Client exchanges `guestId` with `POST /api/auth/guest-session` for a signed JWT.
   - JWT is used for all REST requests and Socket.IO connection authentication.

2. **Authoritative Clock Synchronization**:
   - Clients send `clock:ping` -> Server replies with `clock:pong` containing `serverTimestamp`.
   - Client calculates Round Trip Time (RTT) and estimated server clock offset:
     $$\text{Estimated Server Time} = \text{Client Local Time} + \text{Clock Offset}$$

3. **Scheduled Playback (`executeAt`)**:
   - Actions (`PLAY`, `PAUSE`, `SEEK`, `TRACK_CHANGE`) calculate a future server timestamp:
     $$\text{executeAt} = \text{serverNow} + \text{SCHEDULE\_BUFFER\_MS} \quad (\text{default: } 1500\text{ms})$$
   - Clients calculate execution delay:
     $$\text{delay} = \text{executeAt} - \text{estimatedServerNow}$$
   - Allows clients with varying network latencies (20ms to 500ms+) to trigger playback simultaneously.

4. **Dynamic Timestamp-Based Playback Model**:
   - Stored in Redis: `basePositionMs`, `updatedAt`, `status`, `sequence`, `trackId`.
   - If `playing`: $\text{currentPosition} = \text{basePositionMs} + (\text{serverNow} - \text{updatedAt})$.
   - If `paused`: $\text{currentPosition} = \text{basePositionMs}$.
   - No high-frequency writes (no 50ms/100ms database polling loops).

5. **Monotonic Sequence & Command IDs**:
   - Prevents stale, duplicated, or out-of-order execution during reconnections or network hiccups.

6. **Periodic Drift Correction**:
   - Authoritative `player:sync` heartbeat sent every 5 seconds.
   - **Drift Rules**:
     - $< 50\text{ms}$: No action.
     - $50\text{ms} - 300\text{ms}$: Smooth rate correction ($0.99\times$ or $1.01\times$).
     - $> 300\text{ms}$: Controlled seek.
     - $> 500\text{ms}$: Hard resynchronization.

7. **Horizontal Scalability**:
   - Integrated with Socket.IO Redis Adapter for seamless multi-instance deployment behind a load balancer.

---

## Quick Start & Installation

### Prerequisites
- Node.js 20+
- Docker & Docker Compose (or local PostgreSQL and Redis instances)

### Option A: Run with Docker Compose (Recommended)

```bash
docker-compose up --build
```
This boots PostgreSQL, Redis, and the Node.js backend.

### Option B: Local Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   ```

3. **Generate Prisma Client & Push Database Schema**:
   ```bash
   npm run prisma:generate
   npm run prisma:push
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

5. **Run Tests & Multi-Client Simulation**:
   ```bash
   npm run test
   npm run test:sim
   ```

---

## API & Socket Contract Specification

### Swagger UI
When running, interactive OpenAPI / Swagger documentation is available at:
`http://localhost:3000/api/docs`

### REST Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service health status | No |
| `POST` | `/api/auth/guest-session` | Initialize / resume guest session | No |
| `POST` | `/api/rooms` | Create new listening room (creator = host) | Bearer JWT |
| `GET` | `/api/rooms/:roomCode` | Retrieve room details & playback state | Bearer JWT |
| `POST` | `/api/rooms/:roomCode/join` | Join existing room | Bearer JWT |
| `POST` | `/api/rooms/:roomCode/leave` | Leave room (auto-migrates host) | Bearer JWT |

---

## Exact JSON Examples for Socket Events

### 1. Clock Synchronization
**Client Emits (`clock:ping`):**
```json
{
  "clientSentTime": 1755741600000
}
```

**Server Responds (`clock:pong`):**
```json
{
  "clientSentTime": 1755741600000,
  "serverTimestamp": 1755741600025
}
```

---

### 2. Scheduled PLAY Command
**Server Broadcasts (`player:command`):**
```json
{
  "commandId": "cmd_a8f9c1e2b4d7",
  "sequence": 1001,
  "type": "PLAY",
  "trackId": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "positionMs": 45000,
  "executeAt": 1755741601500,
  "issuedAt": 1755741600000
}
```

---

### 3. Scheduled PAUSE Command
**Server Broadcasts (`player:command`):**
```json
{
  "commandId": "cmd_b1c2d3e4f5a6",
  "sequence": 1002,
  "type": "PAUSE",
  "trackId": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "positionMs": 48750,
  "executeAt": 1755741603500,
  "issuedAt": 1755741602000
}
```

---

### 4. Scheduled SEEK Command
**Server Broadcasts (`player:command`):**
```json
{
  "commandId": "cmd_c3d4e5f6a7b8",
  "sequence": 1003,
  "type": "SEEK",
  "trackId": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "positionMs": 135000,
  "executeAt": 1755741610000,
  "issuedAt": 1755741608500
}
```

---

### 5. Scheduled TRACK_CHANGE Command (Next / Previous)
**Server Broadcasts (`player:command`):**
```json
{
  "commandId": "cmd_d4e5f6a7b8c9",
  "sequence": 1004,
  "type": "NEXT",
  "trackId": "spotify:track:7qiZfU4dY1lWllzX7mPBI3",
  "positionMs": 0,
  "executeAt": 1755741612000,
  "issuedAt": 1755741610500
}
```

---

### 6. Periodic Drift Sync / Resync (`player:sync`)
**Server Broadcasts (`player:sync`):**
```json
{
  "type": "SYNC",
  "roomId": "room-uuid-1234",
  "trackId": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "status": "playing",
  "positionMs": 78230,
  "serverTimestamp": 1755741615230,
  "sequence": 1085
}
```

---

### 7. Client Acknowledged Receipts
**Client Emits (`command:received`):**
```json
{
  "commandId": "cmd_a8f9c1e2b4d7",
  "guestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Client Emits (`command:executed`):**
```json
{
  "commandId": "cmd_a8f9c1e2b4d7",
  "guestId": "550e8400-e29b-41d4-a716-446655440000",
  "actualPositionMs": 45012
}
```

---

## Client Integration Guide (Flutter / Mobile / Web)

1. **Step 1: Obtain Guest Session Token**:
   - Check local storage for existing `guestId`. If not found, generate UUID v4:
     ```dart
     final guestId = Uuid().v4();
     ```
   - Request token:
     ```http
     POST /api/auth/guest-session
     {"guestId": guestId, "displayName": "Alex"}
     ```
   - Store received JWT token in secure storage.

2. **Step 2: Connect Socket with JWT**:
   ```javascript
   const socket = io('https://your-domain.com', {
     auth: { token: guestToken },
     transports: ['websocket'],
   });
   ```

3. **Step 3: Perform Clock Calibration**:
   - Send `clock:ping` periodically (e.g. 5 samples on connect, then every 30s):
     $$\text{RTT} = T_{\text{client\_recv}} - T_{\text{client\_sent}}$$
     $$\text{Estimated Server Time} = T_{\text{server}} + \frac{\text{RTT}}{2}$$
     $$\text{Clock Offset} = \text{Estimated Server Time} - T_{\text{client\_recv}}$$

4. **Step 4: Execute Scheduled Commands**:
   - When receiving `player:command`:
     - Discard if `sequence <= lastProcessedSequence` or duplicate `commandId`.
     - Calculate $\text{delayMs} = \text{cmd.executeAt} - (\text{clientNow} + \text{clockOffset})$.
     - If $\text{delayMs} > 0$: Schedule Spotify SDK call using a timer for $\text{delayMs}$.
     - If $\text{delayMs} \le 0$ (stale/delayed delivery): Emit `room:resync` to snap to current state immediately.

5. **Step 5: Apply Drift Rules on `player:sync`**:
   - Calculate $\Delta = |\text{actualSpotifyPosition} - \text{sync.positionMs}|$.
   - Apply drift correction table:
     - $\Delta < 50\text{ms}$: Maintain current playback.
     - $50\text{ms} \le \Delta \le 300\text{ms}$: Adjust playback rate to $0.99\times$ or $1.01\times$ until synchronized.
     - $\Delta > 300\text{ms}$: Perform controlled seek to $\text{sync.positionMs}$.
