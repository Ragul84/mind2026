# Gyan Clash Asset Intake

Only ship files referenced by the game. Keep purchased archives and editable
source files outside `assets/`.

## Character animations

Two visually compatible fighters are required. Export transparent PNG or WebP
frames at a consistent canvas size and anchor point.

Required states per fighter:

- `idle`: 6-10 looping frames
- `attack`: 8-12 frames
- `hurt`: 4-6 frames
- `dash`: 6-8 frames
- `victory`: 6-10 frames
- `defeat`: 6-10 frames

Target: no more than 3 MB for both fighters.

## Combat VFX

Select from the paid MagusVFX Slashes and Impacts pack:

- 1 small hit
- 1 heavy hit
- 1 clash
- 1 projectile trail
- 1 attack smear

Select from the paid MagusVFX Casting and Buffs pack:

- 1 charge-up
- 1 streak booster aura
- 1 shield
- 1 heal
- 1 special-ready effect

Use the RPG Maker PNG spritesheets. Prefer 12-18 frames per effect and remove
unused color variants.

Target: no more than 4 MB for all VFX.

## Audio

- attack release
- light impact
- heavy impact
- clash
- booster charge
- shield
- victory
- defeat

Use compressed OGG for Android where supported. Target: no more than 1 MB.

## Bundle budget

- Characters: 3 MB
- VFX: 4 MB
- Audio: 1 MB
- Arena and UI: 2 MB
- Total Gyan Clash target: 10 MB installed maximum
