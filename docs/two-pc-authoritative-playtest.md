# Two-PC authoritative browser smoke test

This checklist exercises the current development-only party flow. It uses real HTTP party routes and real authenticated WebSockets; no production transport or fake server is involved.

## Recommended LAN setup

Run PostgreSQL on the backend host only. Keep `DATABASE_URL` pointed at `localhost` or `127.0.0.1`; do not bind PostgreSQL to the LAN or open its port in the firewall.

On the backend/frontend host (PC A):

```bash
cp backend/.env.example backend/.env
# Set DATABASE_URL in backend/.env to the local PostgreSQL instance.
HOST=0.0.0.0 PORT=3000 CORS_ORIGIN=http://PC_A_LAN_IP:5173 PARTY_STATE_EXPEDITION_DURATION_MS=300000 npm run backend:dev
MOMENTUM_BACKEND_PROXY_URL=http://127.0.0.1:3000 npm run dev -- --host 0.0.0.0
```

`PARTY_STATE_EXPEDITION_DURATION_MS=300000` is a temporary five-minute playtest override. It changes no production/default setting.

PC A can use the loopback URL. PC B uses the backend/frontend host's LAN address:

```text
PC A: http://127.0.0.1:5173/?partyTransport=authoritative
PC B: http://PC_A_LAN_IP:5173/?partyTransport=authoritative
```

The same-origin Vite proxy is the preferred LAN configuration. It forwards `/v1` HTTP and WebSocket traffic from the browser to the backend without exposing PostgreSQL or requiring browser CORS.

For a direct backend target, set `VITE_MOMENTUM_BACKEND_URL=http://PC_A_LAN_IP:3000` when starting the frontend and configure `CORS_ORIGIN` for every frontend origin. Direct secure deployment requires HTTPS/WSS and a trusted certificate; the development token remains development-only.

Allow inbound TCP 5173 from the LAN for the Vite server. The preferred proxy setup only needs TCP 3000 reachable from the same machine; open TCP 3000 from the LAN only if using a direct backend target or a separate frontend host. Do not open PostgreSQL's TCP 5432 (or any temporary test port) to the LAN.

Each browser profile must acquire its own development identity. The first authoritative page load asks for a 1–24 character display name and stores that browser's opaque session in local storage. Use two separate browser profiles or clear the site's local storage before repeating the test; do not copy the session storage between PCs.

## Flow

- [ ] Both PCs open authoritative mode and each acquires a different development identity.
- [ ] PC A selects **Create party**.
- [ ] PC A sees the formatted 10-character join code and itself as leader.
- [ ] PC B enters the code and selects **Join**.
- [ ] Both PCs show the same party code, member count, and leader.
- [ ] Both PCs show the other member's basic online/offline presence.
- [ ] PC A starts the forest expedition.
- [ ] Both PCs show the same passive expedition progress and elapsed time.
- [ ] Each player selects a different activity and both PCs show the updated activity names.
- [ ] Change one activity midway and confirm the expedition continues without losing progress.
- [ ] Let the expedition complete and confirm each player sees their own reward claim button.
- [ ] Claim the reward on both PCs and confirm it disappears only for the player who claimed it.
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
| Shared progress/elapsed time |  |
| Activity reward focus |  |
| Reward claim behavior |  |
| Leave behavior |  |
| Reconnect behavior |  |
| Network/CORS/WSS/proxy issues |  |

## Latest local verification note

The Codex in-app browser was used with two independent local origins (`http://127.0.0.1:5173` and `http://localhost:5173`) so each origin acquired its own development identity. The run confirmed create, join, the shared join code, 2/4 membership on both clients, leader display, online presence, and synchronized forest start through the Vite proxy. Repeat the activity-change, completion-claim, leave, and reconnect rows on a physical two-PC LAN run before treating the checklist as fully green.
