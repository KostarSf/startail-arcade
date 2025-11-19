// description: This example demonstrates how to use a Container to group and manipulate multiple sprites
import { ClientEngine } from "./game/client-engine";

export const clientEngine = new ClientEngine();

export const init = async (parent: HTMLElement) => {
  await clientEngine.initialize(parent);
  return clientEngine;
};
