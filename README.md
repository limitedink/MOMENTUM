# MOMENTUM

> **A persistent multiplayer taskbar RPG built around one idea: always progressing together.**

[**Play the public prototype**](https://limitedink.github.io/MOMENTUM/)

**Momentum** is an in-development idle RPG designed to live quietly alongside whatever else you are doing. While you work, study, browse, or watch videos, your character can keep training skills, gathering resources, crafting equipment, fighting, and contributing to shared goals.

The long-term vision is a small persistent adventure shared with friends or matched players. Players should be able to see one another's presence, choose complementary activities, earn party bonuses, and move expeditions forward without needing everyone online or actively playing at the same time.

> [!NOTE]
> The public build is an early gameplay prototype. Its party expedition is currently simulated locally. The desktop shell and multiplayer backend foundations exist, but live online multiplayer is not connected yet.

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
- Server-authoritative party expedition state with revisions, PostgreSQL persistence, and command idempotency
- The live client still uses its local expedition transport; authoritative client integration remains the next milestone

### Idle progression

- Six trainable skills: **Mining, Smithing, Combat, Fishing, Cooking, and Woodchopping**
- Parallel skill training with shared efficiency
- A Honing slot that supercharges one selected skill
- Level progression, skill upgrades, specializations, and account-wide upgrades
- Versioned local saves, autosaving, and capped offline progress

### Active gameplay

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
- Party activities, lanes, member presence, commands, snapshots, rewards, and reconnect behaviour
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
├── MomentumPartyClient
│   ├── PartySnapshotStore
│   ├── ClientSession
│   └── MomentumPartyTransport
│       ├── LocalPartyTransport today
│       └── Authoritative server transport next
└── Presentation and taskbar UI

Fastify backend
├── HTTP authentication routes
├── WebSocket endpoint
├── PostgreSQL repositories
└── Versioned SQL migrations
```

The client already treats party snapshots as canonical server-owned state. Connection lifecycle, authenticated identity, pending command correlation, reconnect status, latency, and the last accepted revision remain in the client session rather than leaking into the shared party model.

The current local transport is an adapter behind that boundary. Presentation code does not directly control its simulation clock, which keeps the UI ready for a real network transport.

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
- Authoritative party state, revisions, idempotent commands, and real PostgreSQL integration tests

The backend currently supports a small server-authoritative forest expedition state loop. Full expedition simulation, client transport integration, reconnect/resume semantics, rewards, and load testing remain future work.

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

### Backend

Create a PostgreSQL database, copy the example environment file, and update `DATABASE_URL` when necessary:

```bash
cp backend/.env.example backend/.env
npm --prefix backend install
npm run backend:dev
```

The backend checks the database connection and applies pending migrations before listening on its configured host and port.

The current backend protocol supports authenticated party state reads and commands, but the browser client still uses `LocalPartyTransport` until the authoritative client transport milestone is complete.

---

## Verification

Run the client checks:

```bash
npm run typecheck
npm test
npm run build
```

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
- [ ] Connect the client to backend identity and sessions
- [ ] Define and implement the versioned multiplayer protocol
- [ ] Add authenticated WebSocket sessions and authoritative party commands
- [ ] Persist parties, expeditions, characters, and shared progression
- [ ] Add reconnect and resume support, idempotent commands, authorization, and rate limits
- [ ] Expand social presence, shared goals, party bonuses, and cooperative content
- [ ] Build the full taskbar-native desktop experience
- [ ] Expand skills, encounters, equipment, progression, balance, and polish
- [ ] Prepare distribution and a future Steam release

---

## Contributing

Momentum is currently a solo development project. Feedback and bug reports are welcome through GitHub issues. Broader contribution guidelines may be added as the project matures.
