import type { System } from "@/shared/ecs";
import { Graphics, Particle, ParticleContainer, Texture } from "pixi.js";
import type { ClientServices } from "../types";

interface TraceParticle {
  particle: Particle;
  vx: number;
  vy: number;
  lifespan: number;
  age: number;
  minAlpha: number;
  flickerOn: boolean;
  flickerTimer: number;
}

interface BulletEmitter {
  entityId: number;
  frameCounter: number;
  particles: TraceParticle[];
}

// Create white pixel texture
function createWhitePixelTexture(app: ClientServices["pixi"]["app"]): Texture {
  const graphics = new Graphics();
  graphics.rect(0, 0, 2, 2);
  graphics.fill(0xffffff);
  const texture = app.renderer.generateTexture({
    target: graphics,
    textureSourceOptions: {
      scaleMode: "nearest",
    },
  });
  graphics.destroy();
  return texture;
}

export const ParticleSystem: System<ClientServices> = {
  id: "particle-system",
  stage: "presentation",
  init({ services }) {
    // Create particle container
    const particleContainer = new ParticleContainer({
      dynamicProperties: {
        position: true,
        color: true, // For alpha flickering
      },
    });
    services.pixi.camera.addChild(particleContainer);

    // Create white pixel texture
    const particleTexture = createWhitePixelTexture(services.pixi.app);

    // Store in services (we'll add this to types)
    (services as any).particleContainer = particleContainer;
    (services as any).particleTexture = particleTexture;
    (services as any).bulletEmitters = new Map<number, BulletEmitter>();
  },
  tick({ services, dt, time }) {
    const particleContainer = (services as any)
      .particleContainer as ParticleContainer;
    const particleTexture = (services as any).particleTexture as Texture;
    const bulletEmitters = (services as any).bulletEmitters as Map<
      number,
      BulletEmitter
    >;

    if (!particleContainer || !particleTexture) return;

    const { stores, entityIndex } = services;

    // Track active bullet entity IDs
    const activeBulletIds = new Set<number>();

    // Process all bullets
    for (const [serverId, entityId] of entityIndex.entries()) {
      const networkState = stores.networkState.get(entityId);
      const transform = stores.transform.get(entityId);
      const velocity = stores.velocity.get(entityId);

      // Skip if not a bullet or missing data
      if (
        !networkState?.state ||
        networkState.state.type !== "bullet" ||
        !transform ||
        !velocity
      ) {
        continue;
      }

      activeBulletIds.add(entityId);

      // Get or create emitter for this bullet
      let emitter = bulletEmitters.get(entityId);
      if (!emitter) {
        emitter = {
          entityId,
          frameCounter: 0,
          particles: [],
        };
        bulletEmitters.set(entityId, emitter);
      }

      // Calculate bullet velocity direction and speed
      const bulletSpeed = Math.hypot(velocity.vx, velocity.vy);
      const bulletAngle = Math.atan2(velocity.vy, velocity.vx);

      // Emit particles every 2-3 frames
      emitter.frameCounter++;
      if (emitter.frameCounter >= 5) {
        emitter.frameCounter = 0;

        // Calculate emission position (behind bullet)
        const emissionOffset = 5; // Distance behind bullet
        const emissionX = transform.x - Math.cos(bulletAngle) * emissionOffset;
        const emissionY = transform.y - Math.sin(bulletAngle) * emissionOffset;

        // Random angle deviation (±0.1 radians)
        const angleDeviation = (Math.random() - 0.5) * 0.2;
        const emissionAngle = bulletAngle + angleDeviation;

        // Particle speed relative to bullet (30-50% of bullet speed)
        const speedMultiplier = Math.random() * 0.2 + 0.2; // 0.3 to 0.5

        // Random lifespan (500-1000ms)
        const lifespan = (Math.random() * 700 + 500) / 1000; // Convert to seconds

        // Random min alpha (0.2 to 0.5)
        const minAlpha = Math.random() * 0.4 + 0.4;

        // Create particle (smaller size)
        const particle = new Particle({
          texture: particleTexture,
          x: emissionX,
          y: emissionY,
          scaleX: 0.5,
          scaleY: 0.5,
          anchorX: 0.5,
          anchorY: 0.5,
          rotation: emissionAngle,
          tint: 0xffffff,
          alpha: 1.0, // Start at max, will flicker
        });

        particleContainer.addParticle(particle);

        // Calculate velocity components: inherit bullet velocity but slower
        // Start with bullet's velocity scaled down, then add small random deviation
        const baseVx = velocity.vx * speedMultiplier;
        const baseVy = velocity.vy * speedMultiplier;
        // Small random deviation perpendicular to bullet direction
        const randomMagnitude = bulletSpeed * speedMultiplier * 0.1; // 10% of particle speed
        const randomVx = Math.cos(bulletAngle + Math.PI / 2) * randomMagnitude * (Math.random() - 0.5);
        const randomVy = Math.sin(bulletAngle + Math.PI / 2) * randomMagnitude * (Math.random() - 0.5);
        const vx = baseVx + randomVx;
        const vy = baseVy + randomVy;

        emitter.particles.push({
          particle,
          vx,
          vy,
          lifespan,
          age: 0,
          minAlpha,
          flickerOn: true,
          flickerTimer: 0,
        });
      }

      // Update existing particles for this bullet
      for (let i = emitter.particles.length - 1; i >= 0; i--) {
        const traceParticle = emitter.particles[i]!;
        traceParticle.age += dt;

        // Remove if expired
        if (traceParticle.age >= traceParticle.lifespan) {
          particleContainer.removeParticle(traceParticle.particle);
          emitter.particles.splice(i, 1);
          continue;
        }

        // Update position (vx/vy are in pixels/second, dt is in seconds)
        traceParticle.particle.x += traceParticle.vx * dt;
        traceParticle.particle.y += traceParticle.vy * dt;

        // Discrete flickering: toggle between minAlpha and 1.0
        traceParticle.flickerTimer += dt;
        const flickerInterval = 0.05; // Toggle every 50ms
        if (traceParticle.flickerTimer >= flickerInterval) {
          traceParticle.flickerOn = !traceParticle.flickerOn;
          traceParticle.flickerTimer = 0;
        }

        // Set alpha based on flicker state
        const flickerAlpha = traceParticle.flickerOn ? 1.0 : traceParticle.minAlpha;

        // Fade out over lifespan
        const lifeRatio = traceParticle.age / traceParticle.lifespan;
        const baseAlpha = 1 - lifeRatio;
        traceParticle.particle.alpha = flickerAlpha * baseAlpha;
      }
    }

    // Update particles from inactive emitters (bullets that no longer exist)
    // These particles continue to exist and fade out naturally
    for (const [entityId, emitter] of bulletEmitters.entries()) {
      if (activeBulletIds.has(entityId)) {
        continue; // Skip active bullets, already processed above
      }

      // Update existing particles for inactive bullets
      for (let i = emitter.particles.length - 1; i >= 0; i--) {
        const traceParticle = emitter.particles[i]!;
        traceParticle.age += dt;

        // Remove if expired
        if (traceParticle.age >= traceParticle.lifespan) {
          particleContainer.removeParticle(traceParticle.particle);
          emitter.particles.splice(i, 1);
          continue;
        }

        // Update position (vx/vy are in pixels/second, dt is in seconds)
        traceParticle.particle.x += traceParticle.vx * dt;
        traceParticle.particle.y += traceParticle.vy * dt;

        // Discrete flickering: toggle between minAlpha and 1.0
        traceParticle.flickerTimer += dt;
        const flickerInterval = 0.05; // Toggle every 50ms
        if (traceParticle.flickerTimer >= flickerInterval) {
          traceParticle.flickerOn = !traceParticle.flickerOn;
          traceParticle.flickerTimer = 0;
        }

        // Set alpha based on flicker state
        const flickerAlpha = traceParticle.flickerOn ? 1.0 : traceParticle.minAlpha;

        // Fade out over lifespan
        const lifeRatio = traceParticle.age / traceParticle.lifespan;
        const baseAlpha = 1 - lifeRatio;
        traceParticle.particle.alpha = flickerAlpha * baseAlpha;
      }

      // Remove emitter if all particles have expired
      if (emitter.particles.length === 0) {
        bulletEmitters.delete(entityId);
      }
    }
  },
};
