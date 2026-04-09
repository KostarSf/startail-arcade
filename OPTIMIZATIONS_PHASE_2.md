# Backend Optimizations: Phase 2

## Purpose

This document captures the likely second phase of server optimization work after
the first chunk-activity / sleeping-chunks refactor is implemented.

Phase 1 focuses on:

- activation chunks
- sleeping far-away asteroid simulation
- waking chunks from player camera and bullets
- wake stabilization for newly activated chunks

Phase 2 should start only after Phase 1 metrics are collected and verified.

## Goals

- Reduce remaining collision cost inside active areas.
- Reduce remaining entity-update overhead after sleeping chunks already remove
  most far-world work.
- Prepare the simulation for future fully seamless wrap-around behavior.
- Keep the architecture extensible for future "ticket" or priority-based chunk
  activation if needed.

## Recommended Order

| Priority | Area | Why |
| --- | --- | --- |
| 1 | Active-zone collision rewrite | Likely still the hottest path after Phase 1 |
| 2 | Hot-path allocation cleanup | Reduces GC and cost in collision/update code |
| 3 | Query API redesign | Removes array-heavy spatial-query overhead |
| 4 | Generalize sleeping beyond asteroids | Extends chunk freezing to more entity types |
| 5 | Wake/ticket system evolution | Adds more control if simple wake rules become limiting |
| 6 | Seamless wrap-aware visibility/collision layer | Needed for fully borderless presentation |

## 1. Active-Zone Collision Rewrite

Even after sleeping distant chunks, collision inside active chunks may still be
too expensive if it keeps the current "for each entity -> query neighbors"
pipeline.

### Current architectural problems

- Collision walks entities and performs repeated `world.query(...)` calls.
- Each query allocates arrays/accessors.
- Pair tracking uses string keys.
- Event processing repeatedly decodes string pairs back into entities.

### Phase 2 direction

Rewrite discrete collision to operate directly on occupied grid cells:

1. Iterate occupied collision cells instead of all colliders.
2. Process:
   - pairs inside a cell
   - pairs between a cell and a fixed subset of neighboring cells
3. Keep pair generation canonical so duplicates are impossible by construction.
4. Replace string pair keys with numeric or object-based pair storage.
5. Preserve current gameplay behavior first; optimize semantics second.

### Notes

- This rewrite should focus on active chunks only.
- Sleeping-world logic and active-zone collision logic should stay separate.

## 2. Hot-Path Allocation Cleanup

Once active-world simulation is isolated, it becomes easier to remove the most
expensive temporary allocations.

### Main targets

- `BaseEntity.position` / `velocity` getters returning new `Vector2`
- repeated `Vector2.add/sub/mul/normalize` chains in hot loops
- temporary arrays and filtered arrays in query and collision code

### Direction

- Prefer direct numeric access (`x`, `y`, `vx`, `vy`) in hot paths.
- Add small numeric helpers for:
  - squared distance
  - normalized direction from delta
  - angle from delta
- Keep `Vector2` convenience mostly for non-hot code.

## 3. Query API Redesign

Current world queries are ergonomic but expensive in hot code.

### Problems

- `query()` returns arrays immediately.
- `precise()` creates more filtered arrays.
- `set()` / `map()` allocate more collections.

### Direction

Add lower-level APIs for hot systems:

- callback iteration APIs like `forEachNearby(...)`
- caller-provided scratch-buffer APIs
- optional precise filtering without intermediate collections

The old API can remain for non-critical code paths.

## 4. Generalize Sleeping Beyond Asteroids

Phase 1 intentionally freezes only asteroids. Later, sleeping should become a
more general world rule.

### Desired evolution

- Any entity may become sleepable unless it explicitly keeps chunks awake.
- Wake-capable entities should be defined through a stable contract, not by
  hardcoded type checks.
- Sleeping should eventually affect full simulation, not just asteroid update
  and asteroid-vs-asteroid collision.

### Guardrails

- Interaction-capable objects must wake chunks before they can interact with
  sleeping objects.
- Do not introduce mixed semantics where objects collide with sleeping chunks
  without first activating them.

## 5. Wake/Ticket System Evolution

If simple wake rules become too limited, evolve the chunk-activity system toward
ticket-like priorities.

### When this becomes useful

- many wake source kinds with different strengths
- AI systems that should keep regions warm
- scripted events, bosses, objectives, or persistent hazards
- prewarming neighboring chunks for high-speed motion or visibility

### Possible future model

- chunks store a set of wake tickets or a max-priority wake state
- tickets have source type, radius, expiry, and optional priority
- chunk state derives from active tickets instead of only "touched this tick"

This should build on top of the Phase 1 manager, not replace it from scratch.

## 6. Seamless Wrap-Aware World Layer

The long-term design goal is a world that feels seamless across borders.

### Phase 1 approach

- wake across borders via post-pass

### Future direction

- toroidal distance helpers used consistently across:
  - chunk activation
  - visibility queries
  - AI target acquisition
  - collision neighborhood logic
- possibly wrap-aware query helpers so systems stop treating world edges as
  exceptional cases

## 7. Additional Profiling To Add

Before or during Phase 2, expand profiling so each follow-up is measurable.

### Useful metrics

- active-zone collision broad-phase time
- active-zone collision narrow-phase time
- active asteroid count
- active asteroid pair count
- wake stabilization candidate count
- query allocation-heavy call counts
- active vs sleeping entity counts by type

## Decision Gate Before Starting Phase 2

Do not start Phase 2 blindly. First collect post-Phase-1 metrics and answer:

1. Is collision still the top bottleneck inside active chunks?
2. Is entity update still too expensive after sleeping distant asteroids?
3. How many asteroids stay active around one player in realistic play?
4. Are wake/stabilization costs small compared with the time they save?
5. Is the current `UniformGrid` still acceptable, or does active-zone collision
   now justify a direct cell-pair pipeline?

## Success Criteria

Phase 2 is successful if it:

- materially reduces active-zone tick cost
- keeps chunk-activity logic understandable
- does not regress seamless-border goals
- preserves predictable wake/sleep semantics
- leaves room for future ticket-based activation if needed
