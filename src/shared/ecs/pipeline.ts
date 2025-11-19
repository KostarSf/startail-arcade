import type { EntityManager } from "./entity-manager";
import {
  SYSTEM_STAGE_ORDER,
  type System,
  type SystemContext,
  type SystemStage,
} from "./system";

export interface PipelineOptions<TServices extends Record<string, unknown>> {
  entities: EntityManager;
  services: TServices;
}

export interface PipelineTickOptions<TServices extends Record<string, unknown>> {
  dt: number;
  time: number;
  services?: Partial<TServices>;
}

export class Pipeline<
  TServices extends Record<string, unknown> = Record<string, unknown>
> {
  #entities: EntityManager;
  #services: TServices;
  #systems: System<TServices>[] = [];
  #sorted = false;
  #frame = 0;
  #initialized = false;

  constructor(options: PipelineOptions<TServices>) {
    this.#entities = options.entities;
    this.#services = options.services;
  }

  register(system: System<TServices>) {
    this.#systems.push(system);
    this.#sorted = false;
    if (this.#initialized) {
      system.init?.(this.#createContext(0, 0));
    }
  }

  remove(systemId: string) {
    const index = this.#systems.findIndex((system) => system.id === systemId);
    if (index >= 0) {
      this.#systems.splice(index, 1);
    }
  }

  init(currentTime = 0) {
    if (this.#initialized) return;
    this.#initialized = true;
    const ctx = this.#createContext(0, currentTime);
    for (const system of this.#systems) {
      system.init?.(ctx);
    }
  }

  tick(options: PipelineTickOptions<TServices>) {
    this.#frame++;
    if (options.services) {
      Object.assign(this.#services, options.services);
    }
    const ctx = this.#createContext(options.dt, options.time);
    for (const system of this.#getSystems()) {
      if (system.enabled && !system.enabled(ctx)) continue;
      system.tick(ctx);
    }
  }

  #createContext(dt: number, time: number): SystemContext<TServices> {
    return {
      dt,
      time,
      frame: this.#frame,
      entities: this.#entities,
      services: this.#services,
    };
  }

  #getSystems() {
    if (this.#sorted) return this.#systems;
    this.#systems.sort((a, b) => {
      const stageDiff =
        SYSTEM_STAGE_ORDER[a.stage as SystemStage] -
        SYSTEM_STAGE_ORDER[b.stage as SystemStage];
      if (stageDiff !== 0) return stageDiff;
      return (a.priority ?? 0) - (b.priority ?? 0);
    });
    this.#sorted = true;
    return this.#systems;
  }
}
