import { AnimatedSprite, Container, Point, Sprite } from "pixi.js";

/**
 * Centralized helpers for adding and syncing simple drop shadows.
 * Usage pattern:
 *   1. Call `addShadowToContainer` right after creating a sprite/animated sprite.
 *   2. Call `syncShadowForBase` (or `syncShadowsInContainer`) each frame.
 * This keeps shadows consistent across systems and makes future objects easy to support.
 */

const BASE_TO_SHADOW = Symbol("shadow:base-to-shadow");
const SHADOW_TO_BASE = Symbol("shadow:shadow-to-base");

export const SHADOW_TINT = 0x333333;
export const SHADOW_OFFSET_Y = 2;
const TMP_POINT_A = new Point();
const TMP_POINT_B = new Point();

type ShadowCapable = Sprite | AnimatedSprite;

type ShadowBase = ShadowCapable & {
  [BASE_TO_SHADOW]?: ShadowCapable & { [SHADOW_TO_BASE]?: ShadowCapable };
};

type ShadowClone = ShadowCapable & {
  [SHADOW_TO_BASE]?: ShadowCapable;
};

const copyAnchor = (target: ShadowCapable, source: ShadowCapable) => {
  if ("anchor" in target && "anchor" in source && target.anchor && source.anchor) {
    target.anchor.set(source.anchor.x, source.anchor.y);
  }
};

const cloneSprite = (source: ShadowCapable): ShadowCapable => {
  if (source instanceof AnimatedSprite) {
    const clone = new AnimatedSprite(source.textures);
    clone.animationSpeed = source.animationSpeed;
    clone.loop = source.loop;
    clone.gotoAndStop(source.currentFrame);
    if (source.playing) {
      clone.play();
    }
    return clone;
  }

  const clone = new Sprite({
    texture: (source as Sprite).texture,
  });
  clone.roundPixels = (source as Sprite).roundPixels;
  return clone;
};

const linkShadow = (base: ShadowBase, shadow: ShadowClone) => {
  (base as any)[BASE_TO_SHADOW] = shadow;
  (shadow as any)[SHADOW_TO_BASE] = base;
};

const unlinkShadow = (base: ShadowBase) => {
  const shadow = getShadowForBase(base);
  if (!shadow) return;
  delete (shadow as any)[SHADOW_TO_BASE];
  delete (base as any)[BASE_TO_SHADOW];
};

export const createShadowClone = (
  base: ShadowBase,
  options?: { name?: string }
) => {
  const clone = cloneSprite(base);
  copyAnchor(clone, base);
  clone.name = options?.name ?? (base.name ? `${base.name}-shadow` : "shadow");
  clone.tint = SHADOW_TINT;
  clone.alpha = base.alpha;
  clone.eventMode = "none";
  clone.renderable = true;
  linkShadow(base, clone);
  return clone;
};

export const addShadowToContainer = ({
  parent,
  base,
  name,
  index,
}: {
  parent: Container;
  base: ShadowBase;
  name?: string;
  index?: number;
}) => {
  const shadow = createShadowClone(base, { name });
  if (typeof index === "number") {
    parent.addChildAt(shadow, index);
  } else {
    parent.addChild(shadow);
  }
  return shadow;
};

const getShadowForBase = (base: ShadowBase) =>
  (base as any)[BASE_TO_SHADOW] as ShadowClone | undefined;

const getBaseForShadow = (shadow: ShadowClone) =>
  (shadow as any)[SHADOW_TO_BASE] as ShadowBase | undefined;

export const syncShadowForBase = (
  base: ShadowBase,
  options?: {
    cameraScale?: number;
  }
) => {
  const shadow = getShadowForBase(base);
  if (!shadow) return;

  const effectiveScale = Math.max(options?.cameraScale ?? 1, 1);
  const pixelOffset = SHADOW_OFFSET_Y * effectiveScale;

  const parent = base.parent as Container | null;
  if (!parent) {
    shadow.x = base.x;
    shadow.y = base.y + pixelOffset;
  } else {
    TMP_POINT_A.set(base.x, base.y);
    parent.worldTransform.apply(TMP_POINT_A, TMP_POINT_B);
    TMP_POINT_A.set(TMP_POINT_B.x, TMP_POINT_B.y + pixelOffset);
    parent.worldTransform.applyInverse(TMP_POINT_A, TMP_POINT_B);
    shadow.position.set(TMP_POINT_B.x, TMP_POINT_B.y);
  }
  shadow.rotation = base.rotation;
  shadow.scale.set(base.scale.x, base.scale.y);
  shadow.alpha = base.alpha;
  shadow.visible = base.visible;

  if (shadow instanceof AnimatedSprite && base instanceof AnimatedSprite) {
    shadow.animationSpeed = base.animationSpeed;
    shadow.loop = base.loop;
    if (base.playing && !shadow.playing) {
      shadow.gotoAndPlay(base.currentFrame);
    } else if (!base.playing && shadow.playing) {
      shadow.gotoAndStop(base.currentFrame);
    } else if (shadow.currentFrame !== base.currentFrame) {
      shadow.gotoAndStop(base.currentFrame);
      if (base.playing) {
        shadow.play();
      }
    }
  }
};

export const syncShadowsInContainer = (
  container: Container,
  options?: {
    cameraScale?: number;
  }
) => {
  for (const child of container.children) {
    if (isShadowClone(child)) {
      const base = getBaseForShadow(child as ShadowClone);
      if (base) {
        // Shadow positions are driven by their bases, skip direct shadow updates
        continue;
      }
    }
    if (hasShadow(child)) {
      syncShadowForBase(child as ShadowBase, options);
    }
  }
};

const hasShadow = (display: any): display is ShadowBase =>
  Boolean(display && (display as any)[BASE_TO_SHADOW]);

const isShadowClone = (display: any): display is ShadowClone =>
  Boolean(display && (display as any)[SHADOW_TO_BASE]);

export const removeShadowForBase = (base: ShadowBase) => {
  const shadow = getShadowForBase(base);
  if (!shadow) return;
  shadow.parent?.removeChild(shadow);
  shadow.destroy();
  unlinkShadow(base);
};

export const destroyAllShadowsInContainer = (container: Container) => {
  for (const child of container.children) {
    if (isShadowClone(child)) {
      child.destroy();
    }
  }
};
