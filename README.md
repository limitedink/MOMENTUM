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
- **Multiplayer (Planned)** – Cooperative gameplay, shared worlds, and persistent progression.
- **Minigames (Planned)** – A variety of minigames for both singleplayer and multiplayer.

---

## 🛠️ Tech Stack

- **Frontend (Current):** HTML, CSS, JavaScript (vanilla) + Canvas API
- **Frontend (Future):** Potential migration to **Phaser** (2D game framework) or **Three.js** (for 3D/visual depth)
- **Backend (Planned):** Go (Golang) with WebSockets for real-time multiplayer
- **Database (Planned):** PostgreSQL


---

## 🚀 Roadmap

- [x] Idle skilling loop with XP and leveling
- [x] Active arena combat prototype
- [x] Upgrade systems (base + skill-specific)
- [ ] More skills (Woodcutting, Fishing, Magic, etc.)
- [ ] Expanded boss encounters and rewards
- [ ] Core multiplayer backend in Go
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

The current party feature is deliberately client-only, but its boundary is shaped like an authoritative multiplayer client. `PartySnapshot` is the canonical server-owned model. It contains party and expedition state only; connection status, authenticated identity, pending commands, reconnect state, latency, and the last accepted revision live in `ClientSession`.

```text
                         future authoritative server
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

### Remaining work before backend implementation

The client is ready for a server transport, but the server itself still needs protocol/version negotiation, authentication, authorization, persistence, reconnect/resume semantics, command idempotency, authoritative simulation, rate limits, and integration/load tests. None of those backend concerns are implemented by this prototype refactor.

### Verification

Run the repository checks before shipping a client change:

```bash
npm run typecheck
npm test
npm run build
```

Browser verification should confirm that the party panel starts in a connecting state, renders the last accepted snapshot while disconnected/reconnecting, keeps commands pending until an asynchronous confirmation/rejection arrives, and renders untrusted member names/events as text rather than markup.
