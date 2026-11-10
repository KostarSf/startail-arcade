import type { ReplicatedWorldEvent } from "@/shared/network/events";

const compareEvents = (
  left: Pick<ReplicatedWorldEvent, "simTick" | "tickEventIndex">,
  right: Pick<ReplicatedWorldEvent, "simTick" | "tickEventIndex">
) => {
  if (left.simTick !== right.simTick) {
    return left.simTick - right.simTick;
  }

  return left.tickEventIndex - right.tickEventIndex;
};

const getEventId = (event: Pick<ReplicatedWorldEvent, "simTick" | "tickEventIndex">) =>
  `${event.simTick}:${event.tickEventIndex}`;

export class EventBuffer {
  #events: ReplicatedWorldEvent[] = [];
  #seenIds = new Set<string>();

  add(events: ReplicatedWorldEvent[]) {
    let inserted = false;

    for (const event of events) {
      const eventId = getEventId(event);
      if (this.#seenIds.has(eventId)) {
        continue;
      }

      this.#seenIds.add(eventId);
      this.#events.push(event);
      inserted = true;
    }

    if (inserted) {
      this.#events.sort(compareEvents);
    }
  }

  drainUpTo(simTick: number) {
    const drained: ReplicatedWorldEvent[] = [];

    while (this.#events.length > 0) {
      const event = this.#events[0]!;
      if (event.simTick > simTick) {
        break;
      }

      drained.push(event);
      this.#events.shift();
      this.#seenIds.delete(getEventId(event));
    }

    return drained;
  }

  clear() {
    this.#events.length = 0;
    this.#seenIds.clear();
  }
}
