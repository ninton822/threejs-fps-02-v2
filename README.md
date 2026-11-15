# Dusk Harbor — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/ninton822/threejs-fps-02-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/ninton822/threejs-fps-02-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Built for the make.fun bounty: https://make.fun/bounty/threejs-fps-02

A round-based tactical first-person shooter in a harbor freight yard at dusk, built on three.js 0.187.0 with no build step and no network: static files under `game/`, single-player against bots.

## The game

You are **Vanguard** — five attackers against five **Sentinel** defenders on the Pier bombsite. Plant the charge at the Pier in the north, or eliminate the whole defending team. Win **5 rounds** to take the match.

- **Three lanes, one yard.** Crane Alley (west), the Yard (mid), Warehouse Row (east) — containers, crates and corner walls make the sightlines, and bots patrol the waypoint graph between them.
- **Gunplay where accuracy counts.** Hitscan rifles, SMG and pistol with headshot multipliers, recoil and spread that grow while you run, fire on the move, or spray. Stop, crouch, aim — stopping to aim pays. Movement has acceleration, friction, crouching, jumping and axis-separated collision with the map.
- **Tactics.** Money each round ($800 start, $300 a kill, $3250 a round win) buys a better gun or a frag grenade in the buy menu. The charge is planted by holding E in the site and defused by defenders; bots follow routes, hold angles, and hear gunfire and explosions.
- **Bots that fight back.** Defenders hold lanes and rotate to a planted charge to defuse; attackers push lanes in pairs and the carrier plants when the site is clear. They aim after a human reaction delay, fire in bursts, and turn toward sounds.
- **Everything procedural.** All sounds are synthesized with WebAudio — no audio files, no network requests. The map is boxes with a chosen dusk palette: warm sodium lamps against a cold indigo sky.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| R | Reload |
| 1 / 2 / 3 | Pistol / SMG / rifle |
| 4 or G | Throw grenade |
| E (hold) | Plant the charge (in the site, while carrying it) |
| Ctrl / C | Crouch |
| Shift | Move quietly |
| Space | Jump |
| B | Buy menu (buy phase) |

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

## Layout

- `game/index.html` — import map, HUD, overlays (menu, buy, round end, match end)
- `game/src/main.js` — bootstrap, fixed-step simulation, input, shooting, grenades
- `game/src/map.js` — Dusk Harbor: boxes, colliders, waypoint graph, BFS paths
- `game/src/player.js` — acceleration, friction, crouch, jump, box collision
- `game/src/bots.js` — bot AI: routes, holds, vision, bursts, hearing, plant/defuse
- `game/src/weapons.js` — three guns, hitscan ballistics, recoil/spread, grenade
- `game/src/rounds.js` — round flow, economy, buy menu, bomb, match scoring
- `game/src/hud.js` — health, ammo, timer, score, killfeed, banners, buy menu
- `game/src/effects.js` — pooled tracers, muzzle flash, impact sparks, explosions
- `game/src/audio.js` — procedural WebAudio sounds
- `main.ts` — the entry program: copies `game/` + `screenshots/` to `/output` and writes the dossier
