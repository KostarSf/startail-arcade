/**
 * Camera shake manager that handles multiple simultaneous shake effects
 * with amplitude and duration support.
 */
export class CameraShake {
  private shakes: Array<{
    amplitude: number;
    duration: number;
    elapsed: number;
    id: number;
  }> = [];
  private continuousShake: {
    amplitude: number;
    id: number;
  } | null = null;
  private accelerationShake: {
    amplitude: number;
    id: number;
  } | null = null;
  private nextId = 0;
  private time = 0;

  // Fast jittery shake using multiple high-frequency sine waves
  private getShakeValue(time: number, seed: number, frequency: number): number {
    // Combine multiple frequencies for chaotic shake
    const f1 = frequency;
    const f2 = frequency * 1.7;
    const f3 = frequency * 2.3;
    const f4 = frequency * 3.1;

    const v1 = Math.sin(time * f1 * Math.PI * 2 + seed);
    const v2 = Math.sin(time * f2 * Math.PI * 2 + seed * 1.3);
    const v3 = Math.sin(time * f3 * Math.PI * 2 + seed * 2.1);
    const v4 = Math.sin(time * f4 * Math.PI * 2 + seed * 3.7);

    // Combine with different weights for more chaotic motion
    return (v1 * 0.4 + v2 * 0.3 + v3 * 0.2 + v4 * 0.1);
  }

  /**
   * Add a shake effect
   * @param amplitude - Maximum shake offset in pixels
   * @param duration - Duration in seconds
   * @returns Shake ID for potential cancellation
   */
  add(amplitude: number, duration: number): number {
    const id = this.nextId++;
    this.shakes.push({
      amplitude,
      duration,
      elapsed: 0,
      id,
    });
    return id;
  }

  /**
   * Set continuous shake amplitude (for speed-based shake)
   * @param amplitude - Current shake amplitude (0 to disable)
   */
  setContinuousShake(amplitude: number): void {
    if (amplitude > 0) {
      if (!this.continuousShake) {
        this.continuousShake = {
          amplitude: 0,
          id: this.nextId++,
        };
      }
      this.continuousShake.amplitude = amplitude;
    } else {
      this.continuousShake = null;
    }
  }

  /**
   * Set acceleration shake amplitude (for throttle-based shake)
   * @param amplitude - Current shake amplitude (0 to disable)
   */
  setAccelerationShake(amplitude: number): void {
    if (amplitude > 0) {
      if (!this.accelerationShake) {
        this.accelerationShake = {
          amplitude: 0,
          id: this.nextId++,
        };
      }
      this.accelerationShake.amplitude = amplitude;
    } else {
      this.accelerationShake = null;
    }
  }

  /**
   * Update shake state and return current offset
   * @param dt - Delta time in seconds
   * @returns Current shake offset {x, y}
   */
  update(dt: number): { x: number; y: number } {
    this.time += dt;

    // Remove expired shakes
    this.shakes = this.shakes.filter((shake) => shake.elapsed < shake.duration);

    // Update remaining shakes
    let totalX = 0;
    let totalY = 0;

    for (const shake of this.shakes) {
      shake.elapsed += dt;
      const progress = Math.min(shake.elapsed / shake.duration, 1);

      // Decay amplitude over time (ease out)
      const decay = 1 - progress;
      const currentAmplitude = shake.amplitude * decay;

      // Fast jittery shake pattern
      const frequency = 25; // High frequency for rapid shake
      const xShake = this.getShakeValue(this.time, shake.id * 100, frequency);
      const yShake = this.getShakeValue(this.time, shake.id * 200 + 1000, frequency * 1.1);

      totalX += xShake * currentAmplitude;
      totalY += yShake * currentAmplitude;
    }

    // Add continuous shake (for speed-based shake)
    if (this.continuousShake && this.continuousShake.amplitude > 0) {
      const frequency = 20; // High frequency for rapid shake
      const xShake = this.getShakeValue(this.time, this.continuousShake.id * 100, frequency);
      const yShake = this.getShakeValue(this.time, this.continuousShake.id * 200 + 2000, frequency * 1.1);

      totalX += xShake * this.continuousShake.amplitude;
      totalY += yShake * this.continuousShake.amplitude;
    }

    // Add acceleration shake (for throttle-based shake)
    if (this.accelerationShake && this.accelerationShake.amplitude > 0) {
      const frequency = 22; // High frequency for rapid shake
      const xShake = this.getShakeValue(this.time, this.accelerationShake.id * 100, frequency);
      const yShake = this.getShakeValue(this.time, this.accelerationShake.id * 200 + 3000, frequency * 1.1);

      totalX += xShake * this.accelerationShake.amplitude;
      totalY += yShake * this.accelerationShake.amplitude;
    }

    return { x: totalX, y: totalY };
  }

  /**
   * Clear all shakes
   */
  clear(): void {
    this.shakes = [];
  }

  /**
   * Get current shake count (for debugging)
   */
  get activeShakes(): number {
    return this.shakes.length;
  }
}
