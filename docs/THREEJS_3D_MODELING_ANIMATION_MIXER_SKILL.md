# Three.js 3D Modeling and Animation Mixer Skill
## Purpose
Build a polished, mobile-first 3D settlement game inspired by The Settlers and Age of Empires. Prefer authored GLB assets for characters and reusable props; use procedural Three.js geometry only for bespoke buildings, terrain dressing, interaction markers, and effects.

## Required stack
- Three.js with WebGLRenderer, physically based MeshStandardMaterial, ACESFilmicToneMapping, shadow maps, and explicit mobile pixel-ratio limits.
- GLTFLoader for .glb/.gltf.
- SkeletonUtils.clone for every skinned character clone. Never use Object3D.clone() for a rigged character.
- AnimationMixer per character; update each mixer with clamped frame delta time.
- IndexedDB for durable local saves; localStorage only for tiny preferences.
- Keep UI HTML/CSS overlaid on the canvas, compact and touch-first.

## Asset licensing and provenance
Preferred CC0 sources:
- Quaternius character packs and Universal Animation Library: https://quaternius.com/
- Gobkit free GLB library: https://gobkit.com/freebies and https://gobkit.com/api/free
- Kenney 3D asset packs: https://kenney.nl/assets
- Poly Pizza models only after checking the exact model's license.
Record asset name, exact source URL, license, download date, and any required attribution in `ASSET_CREDITS.md`. Do not infer a license from a thumbnail or search snippet. Prefer bundling GLB files in the project for production; runtime hotlinks are acceptable for prototypes only. Never use assets with unclear or incompatible redistribution terms.

## Character model acceptance gates
1. The model is a humanoid, visually legible at the intended mobile camera distance, with a readable silhouette and coherent proportions.
2. Feet face the floor at the origin; confirm forward axis and scale before spawning.
3. Inspect the skeleton and animation clip names on load. Do not assume all assets use Mixamo bone names.
4. Normalize model height to the game's world units using a Box3, then offset the model so its lowest point is at y=0.
5. Use SkeletonUtils.clone for each worker. Give each clone its own AnimationMixer.
6. Keep a procedural fallback visible if the GLB fails to load; surface a small non-blocking status instead of freezing gameplay.
7. Attach tools to a detected hand bone (e.g. hand_r, RightHand, handslotr). Check grip position, orientation, and scale visually. If no hand bone is found, fail safely to a configured fallback attachment point.

## AnimationMixer state machine
Each worker has semantic states: `idle`, `walk`, `carry`, `chop`, `build`, `deliver`, and `unassigned`.
- Find source clips by normalized names; log available clip names once.
- Crossfade state changes over roughly 0.12–0.25 seconds; avoid abrupt resets during locomotion.
- Update each mixer once per frame using `mixer.update(Math.min(clock.getDelta(), 0.05))`.
- For movement, use in-place locomotion clips and move the root with game AI. Avoid root-motion clips unless the game explicitly extracts and applies root motion.
- When a clip is missing, use a procedural fallback for that state.
- For custom tool actions, create a dedicated clip using the actual detected bone names and quaternion keyframes. Do not keyframe a guessed bone name. Use an anticipation pose, contact pose, follow-through, and recovery.
- The chop loop should show: feet planted → torso turns toward tree → both hands control the handle → tool lifts → quick downward arc → brief contact/impact → recovery. Add a small wood-chip effect and sound only at the contact event.
- Avoid running a full-body attack clip if it makes the feet slide or the body rotate away from the tree. Prefer a compatible work clip or a custom upper-body layer.
- If idle/walk and upper-body chop overlap, ensure tracks do not fight over the same bones; use a separate upper-body rig/action or explicitly fade the locomotion action.

## Interaction and worker AI contract
- Assigning a worker to the sawmill creates a persistent job, not a one-off movement command.
- State flow: `FindTree → WalkToTree → Chop → CarryLog → WalkToMill → Deliver → FindTree`.
- Every state must have a timeout or recovery path. If the tree disappears, target is blocked, or path becomes invalid, choose a new reachable target.
- A worker must never remain in a “working” state while standing at the mill without a valid job target.
- Reserve the target tree while a worker chops it. Remove it only when depleted.
- Worker AI movement and animation state must be driven from the same state machine.
- Building interaction opens a compact panel with worker count, job status, Assign/Unassign, and Close.
- Tap selection must not trigger when the pointer moved enough to orbit the camera.

## 3D building modeling direction
Avoid plain boxes and roof slabs. Every important building needs a distinctive silhouette and layered material design:
- Foundation: stone footings, slightly irregular perimeter, visible thickness.
- Main structure: plaster/wood or log walls with exposed corner posts and crossbeams.
- Roof: clearly pitched gable or hip roof, separate fascia, ridge cap, eaves, and a restrained shingle/tile pattern.
- Functional details: door with frame and lintel, windows with muntins, chimney, steps, porch, stacked logs, saw blade/wheel or workbench as appropriate.
- Add contact shadows and small ground clutter, but do not bury the silhouette in decoration.
- Use consistent bevel/edge language, palette, texel density, and scale across the asset set.
- Test each building at the actual gameplay camera and at 390×844 portrait size; the silhouette and interaction target must remain clear.

## Mobile performance and camera
- Use one renderer and one scene; cap pixel ratio around 1.5–1.75 on phones.
- Keep shadow-map sizes modest; avoid excessive transparent materials and draw calls.
- Use frustum culling, reuse geometry/materials, and instance repeated grass/rocks when the world grows.
- Camera: orbit drag, pinch/wheel zoom, one-tap zoom controls, optional follow selected villager. Smooth follow with interpolation; do not snap.
- Keep camera framing wide enough to show the camp and avoid hiding worker destinations behind UI.
- No full-screen instructional paragraphs. Use a dismissible one-line hint and compact contextual panels.

## Definition of done
- GLB loads without console errors and the license is documented.
- Every spawned rig animates independently.
- Idle/walk/chop transitions crossfade without visible snapping.
- The hammer/axe remains attached to the correct hand through all poses.
- Feet remain grounded; no skating during idle or chopping.
- A worker can be assigned, walk to a reachable tree, visibly chop with the tool, carry a log, return to the mill, deliver wood, and repeat.
- The house reads as a designed game asset from the live camera, not as primitive placeholder geometry.
- The game remains usable on a phone with no text overlapping the world.
