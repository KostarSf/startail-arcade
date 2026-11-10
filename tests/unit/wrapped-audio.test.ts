import { expect, test } from "bun:test";
import { AudioEngine } from "../../src/client/audio/audio-engine";

function harness() {
  const audio = new AudioEngine();
  const panners: any[] = [],
    sources: any[] = [];
  const node = () => ({ connect() {}, disconnect() {} });
  // Fake only Web Audio nodes; execute the production AudioEngine routing and positioning.
  const context = {
    listener: { setPosition() {}, setOrientation() {} },
    createBufferSource: () => {
      const source = { ...node(), playbackRate: { value: 1 }, start() {}, stop() {} };
      sources.push(source);
      return source;
    },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createPanner: () => {
      const panner = {
        ...node(),
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      };
      panners.push(panner);
      return panner;
    },
  };
  Object.assign(audio, {
    audioContext: context,
    gameGain: node(),
    uiGain: node(),
    buffers: new Map(["snd_hit", "snd_engine", "snd_click"].map((id) => [id, {}])),
  });
  return { audio, panners, sources };
}

test("one-shot audio stays nearby across both seams, including a listener wrap during playback", () => {
  const { audio, panners } = harness();
  audio.updateListener({ x: 49900, y: 49900 }, { vx: 0, vy: 0 }, 50000);
  const position = { x: -49900, y: -49900 };
  audio.playOneShot({ soundId: "snd_hit", position });
  expect(panners[0].positionX.value).toBe(50100);
  expect(panners[0].positionY.value).toBe(50100);
  expect(position).toEqual({ x: -49900, y: -49900 });
  audio.updateListener({ x: -49950, y: -49950 }, { vx: 0, vy: 0 }, 50000);
  expect(panners[0].positionX.value).toBe(-49900);
  expect(panners[0].positionY.value).toBe(-49900);
});

test("looping sources and Doppler use the shortest direction, including reverse crossings", () => {
  const { audio, panners, sources } = harness();
  audio.updateListener({ x: 49900, y: 0 }, { vx: 0, vy: 0 }, 50000);
  audio.playLoopingSound({
    soundId: "snd_engine",
    entityId: "pirate",
    position: { x: -49900, y: 0 },
    velocity: { vx: 100, vy: 0 },
  });
  expect(panners[0].positionX.value).toBe(50100);
  expect(sources[0].playbackRate.value).toBeLessThan(1); // Receding to the right.
  audio.updateLoopingSound({
    soundId: "snd_engine",
    entityId: "pirate",
    position: { x: 49950, y: 0 },
  });
  audio.updateListener({ x: -49900, y: 0 }, { vx: 0, vy: 0 }, 50000);
  expect(panners[0].positionX.value).toBe(-50050);
  expect(sources[0].playbackRate.value).toBeGreaterThan(1); // Approaching from the left.
});

test("ordinary positional and non-positional audio retain their routing", () => {
  const { audio, panners } = harness();
  audio.updateListener({ x: 100, y: 0 }, { vx: 0, vy: 0 }, 50000);
  audio.playOneShot({ soundId: "snd_hit", position: { x: 300, y: 0 } });
  expect(panners[0].positionX.value).toBe(300);
  audio.playOneShot({ soundId: "snd_click" });
  audio.playLoopingSound({ soundId: "snd_engine", entityId: "player", nonPositional: true });
  expect(panners).toHaveLength(1);
});
