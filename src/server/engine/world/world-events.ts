import type {
  EntityDamageWorldEvent,
  EntityDestroyWorldEvent,
  PlayerLevelUpWorldEvent,
  PlayerScoreWorldEvent,
  ReplicatedWorldEvent,
} from "@/shared/network/events";

export type WorldEventReplication = "none" | "global" | "relevant";

interface WorldEventMetadata {
  replication: WorldEventReplication;
  targetPlayerId?: string;
}

export type WorldEntityDamageEvent = Omit<
  EntityDamageWorldEvent,
  "simTick" | "tickEventIndex"
> &
  WorldEventMetadata;

export type WorldEntityDestroyEvent = Omit<
  EntityDestroyWorldEvent,
  "simTick" | "tickEventIndex"
> &
  WorldEventMetadata;

export type WorldPlayerScoreEvent = Omit<
  PlayerScoreWorldEvent,
  "simTick" | "tickEventIndex"
> &
  WorldEventMetadata;

export type WorldPlayerLevelUpEvent = Omit<
  PlayerLevelUpWorldEvent,
  "simTick" | "tickEventIndex"
> &
  WorldEventMetadata;

export type WorldEvent =
  | WorldEntityDamageEvent
  | WorldEntityDestroyEvent
  | WorldPlayerScoreEvent
  | WorldPlayerLevelUpEvent;

export type CommittedWorldEvent = ReplicatedWorldEvent & WorldEventMetadata;

export type WorldEventListener = (event: CommittedWorldEvent) => void;
