# AriaColony

A cozy isometric colony builder, single-page, playable in any modern browser.

**Play:** open `index.html`. That's it. No build step, no deps.

![preview](https://img.shields.io/badge/play-in%20browser-7ce27c?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-f6c56b?style=flat-square)

## How to play

1. **Place a Town Hall** near the center — it seeds 3 colonists.
2. **Build a Lumberyard** next to forest to start earning wood.
3. **Farms** grow food on grass; pair with a **Well** for a bonus.
4. **Quarries** must touch a stone tile.
5. **Markets** convert food + wood into gold.
6. **Houses** increase population cap; more colonists = more workers.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Pan | Drag with mouse | Drag with finger |
| Zoom | Mouse wheel | Pinch (WIP) |
| Build | Click palette → click tile | Tap palette → tap tile |
| Select building | Click it | Tap it |
| Hotkeys | `1`-`8` palette slots, `Esc` clear, `space` pause | — |
| Speed | Top-right `1x / 2x / 3x / ⏸` button | Same |

## Features

- Procedural map: grass, forest, stone, water
- Day/night cycle — sky + lighting shift over 2 minutes
- Colonists wander, claim jobs, walk between home and workplace
- Adjacency bonuses (lumberyards near forest, farms near wells)
- Construction progress arcs
- Auto-save every 10 seconds to localStorage
- Responsive; works on phones

## Stack

- Plain HTML + CSS + JS
- Single Canvas2D context, isometric projection
- No frameworks, no build, no assets — everything procedural

## License

MIT
