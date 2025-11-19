import type { ShipInputCommand } from "@/shared/ecs/components";

export class InputBuffer {
  #commands: ShipInputCommand[] = [];
  #baseline: ShipInputCommand | null = null;

  enqueue(command: ShipInputCommand) {
    this.#commands.push(command);
  }

  acknowledge(sequence: number) {
    while (this.#commands.length > 0) {
      const command = this.#commands[0];
      if (!command) break;
      if (command.sequence > sequence) break;
      this.#baseline = this.#commands.shift()!;
    }
  }

  reset() {
    this.#commands = [];
    this.#baseline = null;
  }

  setBaseline(command: ShipInputCommand) {
    this.#baseline = command;
    this.#commands = this.#commands.filter(
      (input) => input.sequence > command.sequence
    );
  }

  get baseline() {
    return this.#baseline;
  }

  get pending() {
    return this.#commands;
  }
}
