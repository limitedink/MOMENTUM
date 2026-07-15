# MOMENTUM

**[Play the public prototype](https://limitedink.github.io/MOMENTUM/)**

**Momentum** is a hybrid idle + active multiplayer RPG in development.
Players train skills, earn resources, and face active boss encounters — blending the strategy of long-term idle progression with the intensity of real-time combat.

Inspired by games like **Old School RuneScape**, **Melvor Idle**, **Warframe**, and more. Momentum combines Long-term progression skill depth, idle/automation systems, multiplayer and action-oriented combat into one evolving experience.

---

## 🎯 Design Philosophy

- **Always Progressing** – Whether active or idle, players should feel forward momentum.
- **Idle Meets Action** – Idle loops provide steady growth, while active combat offers rewarding bursts of skill expression and gameplay.
- **Multiplayer First** – A shared world where cooperation, competition, and community matter.
- **Depth + Grind** – Systems should feel layered and engaging, not just repetitive.
- **Player Freedom** – Train what you want, when you want, with multiple viable paths to progression.

---

## ✨ Features

- **Idle Skilling** – Train skills like Mining, Smithing, Combat, and more (many planned).
- **Combat Discipline** – Earn talent points from Combat milestones and build into Mobility, Assault, or Survival with mutually exclusive capstones.
- **Active Boss Fights** – Step into an arena for real-time battles with WASD controls, dodges, ranged & melee combat.
- **Run Records** – Arena summaries track weapon performance, clear times, damage, defensive actions, and best records.
- **Various upgrade systems** – Base upgrades and skill-specific upgrades to boost progression.
- **Global/Social Buffs** – Defeat bosses solo for limited-time multipliers and rare loot or with others for shared buffs special bonuses.
- **Multiplayer foundation (Current)** – Persistent parties, authenticated sessions, party-aware WebSocket connections, isolated asynchronous presence, and the first persisted server-authoritative party expedition state loop. The live client still uses its local expedition transport.
- **Minigames (Planned)** – A variety of minigames for both singleplayer and multiplayer.

---

## 🛠️ Tech Stack

- **Frontend (Current):** HTML, CSS, JavaScript (vanilla) + Canvas API
- **Frontend (Future):** Potential migration to **Phaser** (2D game framework) or **Three.js** (for 3D/visual depth)
- **Backend (Current foundation):** Fastify + TypeScript with WebSockets
- **Database (Current foundation):** PostgreSQL


---

## 🚀 Roadmap

- [x] Idle skilling loop with XP and leveling
- [x] Active arena combat prototype
- [x] Upgrade systems (base + skill-specific)
- [ ] More skills (Woodcutting, Fishing, Magic, etc.)
- [ ] Expanded boss encounters and rewards
- [x] Authenticated backend, persistent parties, and party-aware WebSocket foundation
- [ ] Authoritative multiplayer snapshots, activity synchronization, and expedition simulation
- [x] Local persistence (versioned browser saves)

---

## 📂 Project Setup

Clone the repository:

```bash
git clone https://github.com/limitedink/MOMENTUM.git
cd momentum
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser. No build step is required.

## 🤝 Contributing

Momentum is currently a solo dev project.
In the future, collaboration and contributions may be welcome.


## Client architecture and backend readiness

The client party gameplay simulation is deliberately local-only, but its boundary is shaped like an authoritative multiplayer client. The backend now provides persistent identity, parties, authenticated WebSocket sessions, party presence, and a small persisted authoritative expedition state loop; it does not yet provide full authoritative expedition simulation. The legacy local `PartySnapshot` remains the client simulation model. The backend's `party.state.snapshot` is a separate, smaller server-owned model; connection status, authenticated identity, pending commands, reconnect state, latency, and the last accepted revision live in `ClientSession`.

```text
                  authoritative party state server
                                  │
                 snapshots + command results (async messages)
                                  │
                         MomentumPartyTransport
                                  │
             ┌────────────────────┴────────────────────┐
             │                                         │
       PartySnapshotStore                         ClientSession
       canonical server state                  lifecycle + identity
       revision ordering                        pending/correlation
             └────────────────────┬────────────────────┘
                                  │
                         MomentumPartyClient
                         application command API
                                  │
                         taskbar presentation

  LocalPartyTransport is only one adapter behind the same boundary.
  Its elapsed-time and tick helpers are test-only adapter capabilities;
  presentation code never calls them.
```

### Responsibilities

- **Transport:** asynchronous connect/disconnect, session identity, snapshot requests, command submission, and typed message streams. A future server transport can replace `LocalPartyTransport` without changing rendering or command code.
- **Snapshot store:** validates and accepts only newer canonical snapshots. Legacy local-save aliases are adapted inside the local adapter and never enter the canonical model.
- **Client session:** owns connection/reconnect lifecycle, authenticated player ID, current party ID, pending command correlation, command errors, latency, and `lastAcceptedRevision`.
- **Client facade:** composes the store, session, and transport into the small application API consumed by the UI.
- **Presentation:** renders validated snapshot data and session status. Server-provided names and events are escaped before insertion into HTML.

### Remaining work before full authoritative multiplayer implementation

The backend state loop is ready for a future client transport, while `LocalPartyTransport` remains the active client adapter. Remaining work includes a server transport adapter, reconnect/resume semantics, client snapshot mapping, full activity synchronization, expedition simulation, rewards, and load testing.

### Authenticated WebSocket foundation

`/v1/ws` prefers an `Authorization: Bearer dev_...` header during upgrade. Browser clients that cannot set upgrade headers may send one first `auth` message instead; tokens are never accepted in query parameters. Protocol version 1 supports `ping`, `party.refresh`, `party.state.get`, and `party.command`, with server messages `connection.ready`, `pong`, `party.snapshot`, `party.presence`, `party.state.snapshot`, `party.state.error`, and `party.command.result`.

Party scope is always resolved from the authenticated player's PostgreSQL membership. After a successful HTTP party create, join, or leave request, clients must send `party.refresh` on each existing socket before using authoritative state. State revisions are optimistic-concurrency guards, command IDs are persisted for idempotent retries, and expedition completion is reconciled when state is accessed. The current connection registry is in-memory and single-server; Redis and cross-instance fanout are intentionally deferred.

### Verification

Run the repository checks before shipping a client change:

```bash
npm run typecheck
npm test
npm run build
```

Browser verification should confirm that the party panel starts in a connecting state, renders the last accepted snapshot while disconnected/reconnecting, keeps commands pending until an asynchronous confirmation/rejection arrives, and renders untrusted member names/events as text rather than markup.
