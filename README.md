# MOMENTUM

> **A persistent multiplayer taskbar RPG built around one idea: always progressing together.**

[**Play the public prototype**](https://limitedink.github.io/MOMENTUM/)

**Momentum** is an in-development idle RPG designed to live quietly alongside whatever else you are doing. While you work, study, browse, or watch videos, your character can keep training skills, gathering resources, crafting equipment, fighting, and contributing to shared goals.

The long-term vision is a small persistent adventure shared with friends or matched players. Players should be able to see one another's presence, choose complementary activities, earn party bonuses, and move expeditions forward without needing everyone online or actively playing at the same time.

> [!NOTE]
> The public build is an early gameplay prototype and defaults to the local party simulation. The desktop shell and multiplayer backend foundations exist. The browser client can opt into the current authoritative party transport for development, but full online party management and gameplay parity are still in progress.

Momentum takes inspiration from the long-term skill progression of **Old School RuneScape**, the idle systems of **Melvor Idle**. Its primary focus is bringing meaningful persistent multiplayer to the low-attention taskbar RPG format.

---

## Design pillars

- **Always progressing but better together:** Personal progress should also feel connected to a wider party journey.
- **Quiet by default, active by choice:** The game should remain useful in the background while offering rewarding moments of direct play.
- **Meaningful multiplayer:** Social presence, complementary activities, shared goals, and party bonuses should matter mechanically.
- **Long-term mastery:** Skills, equipment, upgrades, specializations, and difficult goals should support a satisfying grind.
- **Respect for player attention:** Momentum should invite check-ins rather than demand constant focus.

---

## Current prototype

### Backend multiplayer foundation

- Persistent players, sessions, parties, memberships, and authenticated party-aware WebSockets
- Authenticated frontend party creation, join-code join, leave, named member listing, separate You/Leader badges, and presence refresh
- Server-authoritative party expedition state with revisions, PostgreSQL persistence, passive activity rewards, and command idempotency
- A browser client identity/session adapter backed by the development player endpoint and `/v1/me`; development identities request a validated 1–24 character display name
- Explicit local versus authoritative party runtime modes, with local fallback when development identity acquisition is unavailable
- The default/public client still uses the local expedition transport; authoritative mode is opt-in while the server command set is intentionally small

### Idle progression

- Six trainable skills: **Mining, Smithing, Combat, Fishing, Cooking, and Woodcutting**
- Parallel skill training with shared efficiency
- A Honing slot that supercharges one selected skill
- Level progression, skill upgrades, specializations, and account-wide upgrades
- Versioned local saves, autosaving, and capped offline progress

### Active gameplay

- Solo Frontier's persistent Push/Farm/Pause loop, 30-stage route, deterministic combat, targeted loot, wall diagnosis, return debrief, and offline catch-up
- Real-time arena combat with movement, dashing, attacks, equipment, and loadout choices
- Three progressive boss tiers with distinct stats, attacks, requirements, and rewards
- Combat Discipline talent branches with mutually exclusive capstones
- Active Fishing as an optional burst-reward activity that can also boost idle Fishing
- Frontier Mastery, combat Directives, objectives, and an activity ledger

### Items and economy

- Resource production and processing across connected skills
- Smithing failures, Scrap recycling, bait preparation, fish rarity, and multiple wood tiers
- Craftable equipment and tools
- Character inventory and configurable loadouts

### Multiplayer client foundation

- A local asynchronous Forest Expedition that continues while the player focuses elsewhere
- Party activities, lanes, member presence, commands, snapshots, passive activity rewards, and reconnect behaviour
- A transport boundary designed so the local simulation can later be replaced by an authoritative server transport
- Separate canonical party state and client session state, including revisions, pending commands, reconnect status, identity, and latency

### Platform foundation

- Public browser build hosted through GitHub Pages
- TypeScript and Vite application entrypoint
- Tauri 2 desktop shell for the future taskbar-native version
- Canvas-based active gameplay and SCSS interface styling

---

## Project status

| Area | Status |
| --- | --- |
| Public browser prototype | Playable |
| Core idle and active loops | Implemented |
| Solo Frontier balance and regression audit | Passing; deterministic evidence recorded |
| Local party expedition | Implemented prototype |
| Versioned saves and offline progress | Implemented |
| Tauri desktop shell | Implemented foundation |
| PostgreSQL backend and development auth | Implemented foundation |
| Live server-backed parties | In development |
| Persistent online multiplayer | Planned |
| Steam release | Planned |

---

## Architecture

```text
Browser or Tauri client
├── Gameplay runtime
├── PartyRuntime
│   ├── LocalPartyTransport fallback
│   └── AuthoritativePartyTransport
│       ├── Backend identity/session acquisition
│       ├── Party scope and presence
│       └── Revisioned state and command correlation
└── Presentation and taskbar UI

Fastify backend
├── HTTP authentication routes
├── WebSocket endpoint
├── PostgreSQL repositories
└── Versioned SQL migrations
```

The client already treats party snapshots as canonical server-owned state. Connection lifecycle, authenticated identity, pending command correlation, reconnect status, latency, and the last accepted revision remain in the client session rather than leaking into the shared party model. The server records activity-time segments while an expedition is active, so changing from Patrol to Foraging, Cooking, or Trapping preserves time already spent and shifts only future reward generation.

The current local transport is an adapter behind that boundary. Presentation code does not directly control its simulation clock, which keeps the UI ready for a real network transport.

### Authoritative client transport

`createAuthoritativePartyTransport` in `src/party/authoritative-party-transport.ts` is the browser-compatible adapter for the versioned backend protocol. It sends the bearer token in the required first `auth` message, tracks connection lifecycle and party scope, exposes presence and authoritative state subscriptions, and correlates requests by `requestId`.

The adapter accepts only newer state revisions; equal or stale snapshots are harmless. It preserves caller-supplied `commandId` values when retrying commands after a transient disconnect, and safely ignores duplicate or unknown command results. Reconnect uses bounded exponential backoff and stops for authentication or permanent protocol failures. Callers must mark known HTTP membership changes with `markPartyMembershipChanged()` and refresh the party scope before requesting state again.

The server-supported forest expedition commands are `expedition.start`, activity selection, `expedition.reward.claim`, and leader-only `expedition.reset`. Expedition progress is passive; there are no contribution buttons. Existing local pause, resume, and other simulation commands remain local-only and are rejected by this adapter rather than being remapped. The adapter is tested independently of the existing `LocalPartyTransport` and is now selected by the frontend party runtime when authoritative mode is enabled.

### Party runtime modes

The frontend runtime resolves its mode in this order: the `partyTransport=authoritative` or `partyTransport=local` query parameter, then `VITE_MOMENTUM_PARTY_MODE`, then local mode. Authoritative mode acquires a development player/session, connects the authenticated WebSocket transport, and renders server-owned party state, elapsed progress, activity focus, rewards, and presence. Patrol primarily generates Combat XP and Boss Keys; Foraging generates Woodchopping XP and Pine Logs; Cooking generates Cooking XP and Cooked Fish; Trapping generates Hunting XP and Game. Every member also receives shared XP from the activities their party performed. If identity acquisition fails and fallback is enabled, the runtime switches to `LocalPartyTransport` and exposes the reason in its state.

For local development, run the backend and Vite dev server, then open `/` with `?partyTransport=authoritative`. `VITE_MOMENTUM_BACKEND_URL` may point the client at a different backend; `MOMENTUM_BACKEND_PROXY_URL` configures the Vite development proxy for `/v1` and WebSocket traffic, defaulting to `http://127.0.0.1:3000`. The development identity token and display name are stored in browser local storage for reuse and are not a production authentication design. See [`docs/two-pc-authoritative-playtest.md`](docs/two-pc-authoritative-playtest.md) for LAN commands.

---

## Backend foundation

The backend is implemented in **TypeScript** with **Fastify**, **WebSockets**, and **PostgreSQL**. The current foundation includes:

- Typed environment configuration and structured logging
- `/healthz` liveness and `/readyz` database readiness endpoints
- An authenticated `/v1/ws` WebSocket endpoint with party scope and presence
- Automatic versioned PostgreSQL migrations at startup
- Persistent player and session records
- Opaque `dev_*` access tokens stored only as SHA-256 hashes
- Bearer authentication, `GET /v1/me`, and current-session revocation
- Explicit opt-in CORS origins for direct browser API targets; same-origin Vite proxying remains preferred for LAN development
- Authoritative party state, revisions, idempotent commands, passive activity segments, claimable rewards, and real PostgreSQL integration tests

The backend currently supports a server-authoritative forest expedition state loop. The browser client can acquire development identity, select authoritative mode, manage its current party, render elapsed progress, select activity focus, and claim each member's completion reward. Combat, Hunting, and future skill-specific reward depth can continue to expand on top of this reward ledger.

---

## Tech stack

- **Client:** TypeScript, JavaScript, Vite, SCSS, Canvas API
- **Desktop:** Tauri 2
- **Backend:** Node.js, TypeScript, Fastify, WebSockets
- **Database:** PostgreSQL with versioned SQL migrations
- **Testing:** Vitest and PostgreSQL integration tests
- **Hosting:** GitHub Pages for the public prototype

---

## Local development

### Browser client

```bash
git clone https://github.com/limitedink/MOMENTUM.git
cd MOMENTUM
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

### Desktop client

Install the platform prerequisites for Tauri and Rust, then run:

```bash
npm run tauri:dev
```

For the two-person LAN playtest, start the backend with:

```bash
npm run backend:lan
```

The local-only `.env.playtest` file contains the backend host address. Update that address if the laptop's LAN IP changes, then build with:

```bash
npm run tauri:build:playtest
```

### Backend

Create a PostgreSQL database, copy the example environment file, and update `DATABASE_URL` when necessary:

```bash
cp backend/.env.example backend/.env
npm --prefix backend install
npm run backend:dev
```

The backend checks the database connection and applies pending migrations before listening on its configured host and port.

The current backend protocol supports authenticated party state reads and commands. The browser client defaults to `LocalPartyTransport`, while `?partyTransport=authoritative` or `VITE_MOMENTUM_PARTY_MODE=authoritative` enables the deliberate authoritative rendering path.

### Two-PC browser playtest

For a same-LAN smoke test, keep PostgreSQL bound to the backend host only, run the backend with `HOST=0.0.0.0`, and run Vite with `--host 0.0.0.0`. Set `MOMENTUM_BACKEND_PROXY_URL=http://127.0.0.1:3000` on the frontend host and have both PCs open `http://<frontend-host-ip>:5173/?partyTransport=authoritative`. The Vite proxy keeps browser HTTP/WebSocket traffic same-origin and does not expose PostgreSQL. The full flow is documented in [docs/two-pc-authoritative-playtest.md](</Users/limitedink/workspace/github.com/gamedev/momentum/docs/two-pc-authoritative-playtest.md>).

For a direct backend target, configure `VITE_MOMENTUM_BACKEND_URL` and the backend `CORS_ORIGIN` allowlist for the frontend origin. A production-like remote deployment should use HTTPS/WSS with a trusted certificate; development bearer tokens are not production identity.

---

## Verification

Run the client checks:

```bash
npm run balance:solo
npm run typecheck
npm test
npm run build
```

The balance command writes its deterministic report to `artifacts/solo-frontier/balance-report.json`. See [Momentum v21 — Wayfinder Arsenal](docs/solo-frontier.md) for the solo decision loop, canonical Arsenal, Combat Matrix and Drill, Offense trees, Gold economy, v21 migration guarantees, deterministic acceptance results, and deferred scope.

Run the backend checks:

```bash
npm run backend:typecheck
npm run backend:test
npm run backend:build
```

Database integration tests run when `DATABASE_URL` is available.

---

## Roadmap

- [x] Core idle skilling, XP, levelling, upgrades, and offline progress
- [x] Active arena combat with progressive boss tiers and run records
- [x] Passive and active Fishing
- [x] Crafting, equipment, inventory, and loadouts
- [x] Combat talents, skill specializations, and Frontier Mastery
- [x] Local asynchronous party expedition prototype
- [x] Server-ready party client architecture
- [x] Tauri desktop shell
- [x] PostgreSQL migrations, persistent players, sessions, and development authentication
- [x] Define and implement the versioned multiplayer protocol
- [x] Add authenticated WebSocket sessions and authoritative party commands
- [x] Implement the browser-compatible authoritative client transport adapter
- [x] Connect the client to backend identity and sessions, then migrate the party UI with an explicit local fallback
- [x] Add authenticated frontend party management and two-PC authoritative smoke-test support
- [ ] Persist parties, expeditions, characters, and shared progression
- [x] Add reconnect and resume support, idempotent commands, authorization, and rate limits
- [ ] Expand social presence, shared goals, party bonuses, and cooperative content
- [ ] Build the full taskbar-native desktop experience
- [ ] Expand skills, encounters, equipment, progression, balance, and polish
- [ ] Prepare distribution and a future Steam release

---

## Contributing

Momentum is currently a solo development project. Feedback and bug reports are welcome through GitHub issues. Broader contribution guidelines may be added as the project matures.
