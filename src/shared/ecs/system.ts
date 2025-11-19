import type { EntityManager } from "./entity-manager";

export type SystemStage =
  | "input"
  | "prediction"
  | "simulation"
  | "network"
  | "presentation";

export const SYSTEM_STAGE_ORDER: Record<SystemStage, number> = {
  input: 0,
  prediction: 1,
  simulation: 2,
  network: 3,
  presentation: 4,
};

export interface SystemContext<TServices = Record<string, unknown>> {
  dt: number;
  time: number;
  frame: number;
  entities: EntityManager;
  services: TServices;
}

export interface System<TServices = Record<string, unknown>> {
  id: string;
  stage: SystemStage;
  priority?: number;
  init?(ctx: SystemContext<TServices>): void;
  enabled?(ctx: SystemContext<TServices>): boolean;
  tick(ctx: SystemContext<TServices>): void;
}
