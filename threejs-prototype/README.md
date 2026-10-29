# Aria Colony 3D

A browser-first 3D colony-builder prototype inspired by miniature dioramas, The Settlers, and classic RTS games.

## Current prototype

- Procedural 3D island, creek, stepping stones, trees, rocks, bridge, hut, stockpile, and camp details.
- Small human-shaped villagers with simple rigged procedural geometry and animated walk/work cycles.
- Autonomous timber loop: villagers travel to a tree, chop it, carry a log, and deliver it to storage.
- Isometric-style camera with orbit, zoom, reset, selection, and simulation speed controls.
- Resource HUD and villager inspector.
- Three.js + TypeScript + Vite, with Rapier installed as the physics foundation for future collision and interaction work.

The scene is generated in code, so no external model assets are required to run the first prototype. GLB/glTF import and full Rapier-driven character movement are planned follow-up steps.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
cd threejs-prototype
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
npm run preview
```

## Controls

- Drag to orbit the camera.
- Scroll or pinch to zoom.
- Select a villager to inspect their task.
- Use the speed button to cycle simulation speed.
- Use pause to stop or resume the simulation.
- Use the home button to reset the camera.
- Toggle labels on or off.

## Architecture

- `src/main.ts`: scene setup, procedural world, villagers, simulation loop, and UI wiring.
- `index.html`: English-language game HUD.
- `vite.config.ts`: Vite build and relative asset paths.

## Next milestones

1. Replace procedural villagers with rigged GLB characters and AnimationMixer clips.
2. Add Rapier colliders and character collision handling.
3. Add grid/navmesh pathfinding and obstacle avoidance.
4. Add building placement, construction jobs, food gathering, and save/load with IndexedDB.
5. Add automated smoke tests and mobile touch tuning.

## License

MIT
