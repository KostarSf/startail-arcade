# Item textures

Imported from [KostarSf/SpaceRocks](https://github.com/KostarSf/SpaceRocks/tree/4b5e2dd9315dd7c28e3c7f798d144abeadce0861),
the GameMaker Studio 2 project `SpaceTail.yyp`.

Animated sprites use the same horizontal PNG strip layout as this project's
`explosion.png`, `bullet.png`, and `jetstream.png`. Frames run left to right in
the order specified by the original sprite's `.yy` sequence. Each frame uses the
original full canvas and RGBA pixels, with no resizing, trimming, or padding.
The source images are GameMaker's top-level composite frames, including all layers.

| File | Source sprite | Frame size | Frames | PNG size | Original speed | Use |
| --- | --- | --- | --- | --- | --- | --- |
| `ammo.png` | `spr_item_bullets` | 32 × 32 | 3 | 96 × 32 | 2 fps | Ammunition pickup, looping |
| `repair.png` | `spr_item_repair` | 32 × 32 | 1 | 32 × 32 | Static | Health / repair pickup |
| `extra-life.png` | `spr_item_extra_live` | 32 × 32 | 10 | 320 × 32 | 8 fps | Extra life pickup, looping |
| `pickup.png` | `spr_item_pickup` | 32 × 32 | 4 | 128 × 32 | 12 fps | Pickup / disappearance effect, play once |
| `energy.png` | `spr_energy` | 16 × 16 | 4 | 64 × 16 | 8 fps | Energy pickup, looping |
| `fuel.png` | `spr_fuel` | 32 × 32 | 3 | 96 × 32 | 0 fps | Three static fuel variants, select one frame |

All sprites have a centered origin (`anchor: 0.5`). Fuel frames are variants,
not an animation; the original game selects a random frame when spawning fuel.
The disappearance effect lasts 4 / 12 seconds and should remove its sprite on
completion. The original fuel pickup shrinks in code rather than using this effect.

To use an animated strip with the existing Pixi approach, slice frame `i` with
`new Rectangle(i * frameWidth, 0, frameWidth, frameHeight)` and the loaded
texture's `source`. Pass the resulting textures to `AnimatedSprite`, set
`animationSpeed = framesPerSecond / 60`, and set `loop = false` for `pickup.png`.
Use nearest-neighbor sampling to preserve the pixel art.

This import adds image assets only. Gameplay spawning, pickup effects, and
runtime texture loading are not connected yet.
