# Backend Optimizations

## Context

Current profiling results with `--debug-performance`:

- Standard load:
  - `entity update`: `0.46-0.53ms`
  - `collision`: `2.47-3.67ms`
  - `network serialize`: `0.12-0.15ms`
  - `ws send`: `0.05-0.06ms`
- Large arena (`50_000` radius / `50_000` asteroids):
  - `entity update`: `13.13-14.36ms`
  - `collision`: `82.30-91.24ms`
  - `network serialize`: `0.10-0.13ms`
  - `ws send`: `0.06-0.08ms`

Main conclusion:

- The current bottleneck is `collision`.
- The second priority is `entity update`.
- Networking is not a problem right now and should not be optimized before simulation.

## Effort Scale

- `S`: up to half a day, local change, low risk
- `M`: 1-2 days, touches several files or hot paths
- `L`: 3-5 days, medium refactor, moderate regression risk
- `XL`: 1+ week, architectural refactor

## Priority Order

| Priority | Area | Why | Effort |
| --- | --- | --- | --- |
| 1 | Collision pipeline rewrite | Takes ~85% of tick time on large arena | `L` |
| 2 | Active simulation / sleeping sectors | Prevents simulating the whole world every tick | `XL` |
| 3 | Hot-path allocation cleanup | Likely a meaningful part of both collision and update cost | `M` |
| 4 | Query API redesign | Current query/accessor API creates unnecessary arrays and filters | `M` |
| 5 | Entity update pass cleanup | `13-14ms` is already too high for future scale | `M` |
| 6 | Collision pair storage cleanup | Removes string-heavy overhead inside critical path | `M` |
| 7 | Collision filtering matrix | Reduces useless checks without changing architecture | `S` |
| 8 | Grid specialization and tuning | Can improve broad-phase efficiency after core fixes | `M` |
| 9 | Partial state / dirty-state cleanup | Good hygiene, but not a current bottleneck | `M` |
| 10 | Better profiling granularity | Helps validate each optimization step | `S` |

## 1. Collision Pipeline Rewrite

Status: highest priority.

### Why

On large arena, collision detection alone costs `82-91ms` per tick. This is the main reason the server drops to ~10 TPS.

### Current issues

- Every tick walks all entities through `world.entities`, which builds `Array.from(...)`.
- For each collider, a separate `world.query(...)` is executed.
- Pair tracking uses string keys such as `"a:b"`.
- Collision event processing repeatedly splits strings and searches by ids.
- Continuous collision path for bullets still performs expensive candidate queries.

### What to change

1. Iterate directly over occupied grid cells instead of iterating all entities and querying around each one.
2. Detect collisions by processing:
   - pairs inside the same cell
   - pairs between a cell and a fixed subset of neighbor cells
3. Separate broad-phase by entity kind:
   - bullet vs living entities
   - ship vs asteroid / ship
   - asteroid vs asteroid
   - skip impossible pairs entirely
4. Move continuous bullet collision into a dedicated fast path.
5. Avoid reconstructing the entire collision pair set with string ids each tick.

### Expected effect

- Biggest single reduction in server tick time.
- Realistically this is the change most likely to cut large-arena tick time by tens of milliseconds.

### Refactor scope

- `src/server/engine/world/collision-resolver.ts`
- `src/server/engine/world/uniform-grid.ts`
- `src/server/engine/world/world.ts`
- Possibly entity collision hooks if pair representation changes

### Notes

- This should be done before trying to micro-optimize math or network code.
- Keep gameplay behavior identical first. Do not mix this with balance tweaks.

## 2. Active Simulation / Sleeping Sectors

Status: architectural priority after collision rewrite.

### Why

The server currently updates the whole world every tick. For very large maps this does not scale, even if collision detection becomes cheaper.

### Current issues

- All asteroids are updated every tick regardless of player proximity.
- Far-away objects consume CPU even when no player can observe or interact with them.
- Refill and world persistence assume a globally hot simulation.

### What to change

1. Split the world into sectors/chunks.
2. Mark sectors as active when:
   - a player is nearby
   - a pirate is nearby
   - bullets or recent collisions happened there
3. Put distant sectors into sleep mode:
   - skip collision
   - skip per-tick entity update
   - optionally update at much lower frequency
4. Wake sectors when an active object approaches them.
5. Decide how sleeping asteroids behave:
   - frozen until activation
   - or analytically advanced only when reactivated

### Expected effect

- Large scalability improvement.
- Required if the design goal is very large arenas with dense asteroid fields.

### Refactor scope

- World update model
- Grid ownership / sector bookkeeping
- Spawning and wake-up rules
- Potentially AI target acquisition rules

### Risk

- High. This changes simulation semantics.
- Requires careful handling of bullets crossing sleeping regions and world wrapping.

## 3. Hot-Path Allocation Cleanup

Status: high priority, medium effort.

### Why

The current code creates many temporary objects in the hottest loops. This increases GC pressure and wastes CPU.

### Current issues

- `BaseEntity.position` and `BaseEntity.velocity` allocate new `Vector2` every access.
- AI code repeatedly chains `Vector2.add/sub/mul/normalize`.
- Collision code allocates vectors for midpoints and moved positions.
- Query API produces arrays, filtered arrays, sets, and maps.

### What to change

1. Replace hot-path `Vector2` getter usage with direct numeric access (`x`, `y`, `vx`, `vy`).
2. Add numeric helper functions for:
   - squared distance
   - normalize vector components
   - angle from delta
3. Keep `Vector2` for non-hot code or authoring convenience only.
4. Reuse scratch arrays where possible.

### Expected effect

- Moderate but broad win across `collision` and `entity update`.
- Also makes profiling clearer because GC noise goes down.

### Refactor scope

- `src/server/engine/entities/base-entity.ts`
- `src/server/engine/entities/ai/pirate-ai.ts`
- `src/server/engine/world/collision-resolver.ts`
- `src/server/engine/entities/ship.ts`
- shared math helpers

## 4. Query API Redesign

Status: high priority after allocation cleanup starts.

### Why

Current `world.query(...).precise().array()` is convenient but expensive.

### Current issues

- Every query creates an array.
- `precise()` creates another filtered array.
- Optional `set()` and `map()` create even more collections.
- The accessor abstraction hides cost and encourages overuse in hot paths.

### What to change

1. Add a low-level API that writes results into a caller-provided scratch buffer.
2. Add a direct callback iteration API:
   - `forEachNearby(...)`
   - `forEachNearbyPrecise(...)`
3. Keep current ergonomic API only for non-hot paths if needed.
4. Audit all call sites and move hot ones to the low-level API.

### Expected effect

- Good reduction in both CPU and memory churn.
- Simplifies later collision and AI optimization.

### Refactor scope

- `src/server/engine/world/world.ts`
- `src/server/engine/world/uniform-grid.ts`
- all hot call sites in AI, collision, and entity logic

## 5. Entity Update Pass Cleanup

Status: medium priority, but required for future scale.

### Why

`entity update` already costs `13-14ms` on large arena. Even after collision is fixed, this remains too high if target is stable 20 TPS with headroom.

### Current issues

- Whole-world update every tick.
- Repeated per-entity work regardless of whether state materially changed.
- Ship logic and AI still do many vector operations and queries.
- Exp magnetism does extra queries per ship.

### What to change

1. Split update paths by entity kind:
   - asteroids
   - bullets
   - ships
   - exp
2. Skip expensive logic for entities that are effectively idle.
3. Reduce per-tick work in pirate AI:
   - fewer exact distance checks
   - fewer repeated passes over candidate sets
4. Revisit exp magnetism and target acquisition so they use low-allocation queries.

### Expected effect

- Medium improvement now.
- More important after collision stops dominating.

### Refactor scope

- `src/server/engine/world/world.ts`
- `src/server/engine/entities/ship.ts`
- `src/server/engine/entities/ai/pirate-ai.ts`
- exp logic

## 6. Collision Pair Storage Cleanup

Status: should be done together with collision rewrite if possible.

### Why

Current pair tracking uses string operations in a performance-critical system.

### Current issues

- Pair key creation allocates strings.
- `split(":")`, `startsWith`, and `endsWith` are used during processing and cleanup.
- Lookup requires `world.find(id)` after decoding string ids.

### What to change

1. Replace string pair keys with numeric or object-based pair representation.
2. Store entity references or compact numeric ids directly.
3. Maintain a per-entity adjacency structure for fast removal on despawn.

### Expected effect

- Small to moderate improvement.
- Bigger benefit when collision count is high.

### Refactor scope

- `src/server/engine/world/collision-resolver.ts`
- entity removal path in world

## 7. Collision Filtering Matrix

Status: quick win, low effort.

### Why

Not every entity type needs to be tested against every other type.

### Current issues

- Broad-phase filtering is mostly geometric.
- Semantic collision rules are applied too late.

### What to change

Add an explicit collision matrix, for example:

- `bullet` vs `ship`, `asteroid`
- `ship` vs `asteroid`, `ship`, `exp`
- `asteroid` vs `asteroid`, `ship`, `bullet`
- `exp` vs `ship`

Everything else should be skipped before narrow-phase work.

### Expected effect

- Cheap win.
- Especially useful before and during collision refactor.

### Refactor scope

- mostly `collision-resolver.ts`

## 8. Grid Specialization and Tuning

Status: desirable after collision rewrite.

### Why

Current grid is generic and simple, which is fine initially, but may not be optimal for mixed object sizes and behaviors.

### Current issues

- One grid serves all entity types.
- Static-ish asteroids and fast bullets share the same broad-phase structure.
- `CELL_SIZE = 500` may be too coarse or too fine depending on pair type and density.

### What to change

1. Benchmark different cell sizes.
2. Consider separate indices for:
   - dynamic colliders
   - mostly static asteroids
   - bullets
3. Consider multi-cell occupancy for large bodies if needed later.

### Expected effect

- Moderate if tuned after measuring.
- Low value if attempted before collision algorithm is fixed.

### Refactor scope

- `src/server/engine/world/uniform-grid.ts`
- collision integration

## 9. Partial State / Dirty-State Cleanup

Status: useful, but not urgent.

### Why

Current network cost is tiny, but the dirty-state model still causes unnecessary state churn.

### Current issues

- Pirate AI marks ship changed every update.
- Energy recharge can force updates frequently.
- Partial-state flow does extra visibility work.
- `queryChanged` exists but is not used.

### What to change

1. Only call `markChanged()` on meaningful state changes.
2. Reuse visibility results instead of querying twice.
3. Revisit whether enemy energy belongs in replicated state.
4. Either use `queryChanged` properly or remove it.

### Expected effect

- Low impact on current server CPU.
- Good hygiene and future-proofing.

### Refactor scope

- `src/server/engine/entities/ai/pirate-ai.ts`
- `src/server/engine/entities/ship.ts`
- `src/server/engine/server-network.ts`

## 10. Better Profiling Granularity

Status: small but valuable.

### Why

Current profiling already showed the primary bottleneck. The next step is to split large buckets before refactoring them.

### What to add

Inside `collision`:

- broad-phase
- narrow-phase
- continuous bullet collision
- collision event dispatch

Inside `entity update`:

- asteroid update
- ship update
- AI update
- bullet update
- exp update

Inside `network serialize`:

- state build
- JSON stringify
- gzip

### Expected effect

- No direct performance gain.
- Reduces the chance of optimizing the wrong subproblem.

### Refactor scope

- profiling only, low risk

## What Not To Optimize Yet

These areas should not be touched before simulation bottlenecks are fixed:

- WebSocket send path
- JSON format changes
- transport protocol replacement
- compression tuning
- client-side render/network interpolation

Current numbers clearly show these are not relevant for the server slowdown.

## Recommended Execution Plan

### Phase 1

- Add finer-grained collision profiling
- Add collision filtering matrix
- Remove obvious hot-path allocations in collision code

Estimated effort: `S-M`

### Phase 2

- Rewrite collision resolver to operate on grid cells and neighbor pairs
- Replace string-based pair tracking

Estimated effort: `L`

### Phase 3

- Clean up hot-path allocations in entity update and AI
- Replace query accessor API with callback/scratch-buffer style usage

Estimated effort: `M`

### Phase 4

- Introduce active sectors / sleeping world simulation

Estimated effort: `XL`

## Expected Outcome

If the project goal is to support very large arenas with tens of thousands of asteroids, the minimum required path is:

1. fix collision architecture
2. reduce hot-path allocations
3. avoid simulating the whole world

Without step 3, the server may improve noticeably, but it will still hit a scaling wall as the arena size and object count continue to grow.
