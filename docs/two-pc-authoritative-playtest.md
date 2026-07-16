# Two-PC authoritative browser smoke test

This checklist exercises the current development-only party flow. It uses real HTTP party routes and real authenticated WebSockets; no production transport or fake server is involved.

## Recommended LAN setup

Run PostgreSQL on the backend host only. Do not bind PostgreSQL to the LAN.

On the backend/frontend host (PC A):

```bash
cp backend/.env.example backend/.env
# Set DATABASE_URL to the local PostgreSQL instance.
HOST=0.0.0.0 PORT=3000 npm run backend:dev
MOMENTUM_BACKEND_PROXY_URL=http://127.0.0.1:3000 npm run dev -- --host 0.0.0.0
```

Open this URL on both PCs, replacing `PC_A_LAN_IP`:

```text
http://PC_A_LAN_IP:5173/?partyTransport=authoritative
```

The same-origin Vite proxy is the preferred LAN configuration. It forwards `/v1` HTTP and WebSocket traffic from the browser to the backend without exposing PostgreSQL or requiring browser CORS.

For a direct backend target, set `VITE_MOMENTUM_BACKEND_URL=http://PC_A_LAN_IP:3000` when starting the frontend and configure `CORS_ORIGIN=http://PC_A_LAN_IP:5173` on the backend. Direct secure deployment requires HTTPS/WSS and a trusted certificate; the development token remains development-only.

## Flow

- [ ] Both PCs open authoritative mode and each acquires a different development identity.
- [ ] PC A selects **Create party**.
- [ ] PC A sees the formatted 10-character join code and itself as leader.
- [ ] PC B enters the code and selects **Join**.
- [ ] Both PCs show the same party code, member count, and leader.
- [ ] Both PCs show the other member's basic online/offline presence.
- [ ] PC A starts the forest expedition.
- [ ] Both PCs show the same active state and authoritative revision.
- [ ] PC B contributes.
- [ ] Both PCs show the updated contribution total and revision.
- [ ] PC B leaves.
- [ ] PC A refreshes membership and sees the updated member list and presence.
- [ ] Disconnect one PC's network or close its WebSocket, then reconnect it.
- [ ] The reconnected PC refreshes party scope and receives the current authoritative state.
- [ ] Select **Leave party** on the remaining client and confirm the UI returns to the join/create state.

## Record

| Field | Result |
| --- | --- |
| Browser/device setup |  |
| Frontend URL |  |
| Backend URL |  |
| Identity acquisition |  |
| Party creation |  |
| Party join |  |
| Shared membership/leader |  |
| Shared revision after start |  |
| Shared contribution/revision |  |
| Leave behavior |  |
| Reconnect behavior |  |
| Network/CORS/WSS/proxy issues |  |

## Latest local verification note

The Codex in-app browser was used with two independent local origins (`http://127.0.0.1:5173` and `http://localhost:5173`) so each origin acquired its own development identity. The run confirmed create, join, the shared `LAVSR-64Q7M` join code, 2/4 membership on both clients, leader display, online presence, and synchronized forest start at revision 1 through the Vite proxy to `http://127.0.0.1:3000`. The contribution command was not accepted in that run: the first locator did not match the icon-decorated button and the server-controlled 60-second expedition expired before the retry. The unit/integration suites cover the accepted command path; a physical two-PC LAN run should repeat the contribution, leave, and reconnect rows before this checklist is considered fully green.
