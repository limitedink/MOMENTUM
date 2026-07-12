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
- **Active Boss Fights** – Step into an arena for real-time battles with WASD controls, dodges, ranged & melee combat.  
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
