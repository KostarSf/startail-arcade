import { Container, Graphics } from "pixi.js";

class Star {
  public graphics: Graphics;
  public x: number;
  public y: number;
  public parallaxFactor: number; // от 0.1 до 0.9
  public baseMaxBrightness: number; // базовая максимальная яркость от 0.6 до 1.0
  public minBrightnessRatio: number; // отношение минимальной яркости к максимальной от 0.5 до 0.8
  public size: number; // размер звезды от 0.7 до 1.5 пикселя
  public lifetime: number; // время жизни в миллисекундах от 5 до 20 секунд
  public age: number; // текущий возраст в миллисекундах
  public flickerTimer: number; // таймер для мерцания
  public flickerInterval: number; // интервал между изменениями мерцания от 1 до 2 секунд
  public flickerProgress: number; // прогресс мерцания от 0 до 1 (0 = minBrightness, 1 = maxBrightness)

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.parallaxFactor = Math.random() * 0.55 + 0.05; // от 0.05 до 0.9
    this.baseMaxBrightness = Math.random() * 0.3 + 0.7; // от 0.6 до 1.0
    this.minBrightnessRatio = Math.random() * 0.4 + 0.1; // от 0.5 до 0.8
    this.size = Math.random() * 2 + 1; // от 0.7 до 1.5 пикселя
    this.lifetime = Math.random() * 5000 + 3000; // от 5000 до 20000 мс (5-20 секунд)
    this.age = 0;
    this.flickerTimer = 0;
    this.flickerInterval = Math.random() * 200 + 100; // от 100 до 300 мс (более частое мерцание)
    this.flickerProgress = Math.random(); // случайное начальное значение от 0 до 1

    // Создаем графику для звезды (белый квадрат случайного размера)
    this.graphics = new Graphics();
    this.graphics.rect(0, 0, this.size, this.size);
    this.graphics.fill(0xffffff);
    this.graphics.x = x;
    this.graphics.y = y;
    this.graphics.alpha = 0; // начинаем прозрачной
  }

  isExpired(): boolean {
    return this.age >= this.lifetime;
  }

  update(
    deltaTime: number,
    cameraWorldX: number,
    cameraWorldY: number,
    cameraScale: number,
    screenWidth: number,
    screenHeight: number,
    scaleInfluence: number,
    baseScale: number,
    staticCameraMode: boolean = false
  ) {
    // Обновляем позицию с учетом параллакса
    // cameraWorldX и cameraWorldY - это мировая позиция камеры (передается напрямую)
    // Звезды находятся вне контейнера камеры, поэтому работаем напрямую с экранными координатами

    // Calculate effective scale for parallax effect only
    // Интерполируем между базовым масштабом и текущим масштабом камеры с учетом scaleInfluence
    // scaleInfluence контролирует влияние масштаба: 0 - полностью нивелируется, 1 - полное следование
    const effectiveScale = baseScale + (cameraScale - baseScale) * scaleInfluence;

    // Вычисляем смещение звезды от камеры в мировых координатах
    let worldOffsetX = this.x - cameraWorldX;
    let worldOffsetY = this.y - cameraWorldY;

    // Применяем параллакс к смещению в мировых координатах
    // Звезды с меньшим parallaxFactor движутся медленнее (дальние звезды)
    const parallaxWorldOffsetX = worldOffsetX * this.parallaxFactor;
    const parallaxWorldOffsetY = worldOffsetY * this.parallaxFactor;

    // Преобразуем смещение в экранные координаты с учетом effectiveScale
    let screenOffsetX = parallaxWorldOffsetX * effectiveScale;
    let screenOffsetY = parallaxWorldOffsetY * effectiveScale;

    // Вычисляем размер области оборачивания в экранных координатах
    // Область должна покрывать весь экран независимо от parallaxFactor
    // Для звезд с маленьким parallaxFactor нужна большая область оборачивания
    const wrapScreenWidth = screenWidth * 2;
    const wrapScreenHeight = screenHeight * 2;

    // Оборачиваем звезды в экранных координатах, чтобы они всегда покрывали весь экран
    while (screenOffsetX < -wrapScreenWidth / 2) {
      screenOffsetX += wrapScreenWidth;
      // Обновляем мировые координаты для корректного оборачивания
      this.x += wrapScreenWidth / (effectiveScale * this.parallaxFactor);
    }
    while (screenOffsetX > wrapScreenWidth / 2) {
      screenOffsetX -= wrapScreenWidth;
      this.x -= wrapScreenWidth / (effectiveScale * this.parallaxFactor);
    }
    while (screenOffsetY < -wrapScreenHeight / 2) {
      screenOffsetY += wrapScreenHeight;
      this.y += wrapScreenHeight / (effectiveScale * this.parallaxFactor);
    }
    while (screenOffsetY > wrapScreenHeight / 2) {
      screenOffsetY -= wrapScreenHeight;
      this.y -= wrapScreenHeight / (effectiveScale * this.parallaxFactor);
    }

    // Вычисляем экранную позицию звезды относительно центра контейнера (0, 0)
    // Контейнер будет перемещен так, чтобы его центр следовал за камерой
    const screenX = screenOffsetX;
    const screenY = screenOffsetY;

    // Устанавливаем позицию звезды
    this.graphics.x = screenX;
    this.graphics.y = screenY;

    // Масштабируем звезды с коэффициентом: когда камера x2, звезды x1.5
    // Используем линейную интерполяцию: при scale=1 -> starScale=1, при scale=2 -> starScale=1.5
    const starScaleFactor = 0.5 * (1 + cameraScale); // 1 -> 1.0, 2 -> 1.5
    this.graphics.scale.set(starScaleFactor);

    // Обновляем возраст звезды
    // deltaTime - это количество миллисекунд с предыдущего кадра
    this.age += deltaTime;

    // Вычисляем текущие min и max яркости на основе жизненного цикла
    const lifeProgress = this.age / this.lifetime;
    let lifeMultiplier = 0;

    if (lifeProgress <= 0.1) {
      // Появление: плавное увеличение от 0 до 1 за 10% времени жизни
      lifeMultiplier = lifeProgress / 0.1;
    } else if (lifeProgress <= 0.5) {
      // Стабильная фаза: полная яркость
      lifeMultiplier = 1;
    } else {
      // Угасание: плавное уменьшение от 1 до 0 после половины срока жизни
      const fadeProgress = (lifeProgress - 0.5) / 0.5; // от 0 до 1
      lifeMultiplier = 1 - fadeProgress;
    }

    // Вычисляем текущие min и max яркости с учетом жизненного цикла
    // В статическом режиме камеры уменьшаем максимальную яркость до 0.7
    const maxBrightnessCap = staticCameraMode ? 0.4 : 0.7;
    const cappedBaseMaxBrightness = Math.min(this.baseMaxBrightness, maxBrightnessCap);
    const currentMaxBrightness = cappedBaseMaxBrightness * lifeMultiplier;
    const currentMinBrightness = currentMaxBrightness * this.minBrightnessRatio;

    // Обновляем мерцание
    this.flickerTimer += deltaTime;
    if (this.flickerTimer >= this.flickerInterval) {
      this.flickerTimer = 0;
      this.flickerInterval = Math.random() * 200 + 100; // от 100 до 300 мс (более частое мерцание)

      // Дискретное изменение прогресса мерцания с шагом минимум 0.1
      const flickerChange = Math.random() * 0.4 + 0.2; // от 0.2 до 0.6 (более заметные изменения)
      const flickerDirection = Math.random() > 0.5 ? 1 : -1;
      let newFlickerProgress = this.flickerProgress + flickerDirection * flickerChange;

      // Ограничиваем диапазон от 0 до 1.0
      newFlickerProgress = Math.max(0, Math.min(1.0, newFlickerProgress));

      // Округляем до шага 0.1
      this.flickerProgress = Math.round(newFlickerProgress * 10) / 10;
    }

    // Вычисляем финальную альфу: интерполируем между min и max яркостью на основе flickerProgress
    const finalAlpha = currentMinBrightness + (currentMaxBrightness - currentMinBrightness) * this.flickerProgress;

    // Округляем до шага 0.1 для дискретности
    this.graphics.alpha = Math.round(finalAlpha * 10) / 10;
  }
}

export class Starfield {
  private stars: Star[] = [];
  private container: Container;
  private scaleInfluence: number; // влияние масштаба камеры на параллакс звезд (0-1)
  private baseScale = 1.5; // Fixed reference scale for camera world position calculation

  constructor(count: number, worldWidth: number, worldHeight: number, scaleInfluence: number = 0.5) {
    this.scaleInfluence = scaleInfluence; // 0 - масштаб полностью нивелируется, 1 - полное следование масштабу
    this.container = new Container();

    // Создаем звезды в начальной области (worldWidth/worldHeight используются только для начальной генерации)
    for (let i = 0; i < count; i++) {
      const x = Math.random() * worldWidth - worldWidth / 2;
      const y = Math.random() * worldHeight - worldHeight / 2;
      const star = new Star(x, y);
      this.stars.push(star);
      this.container.addChild(star.graphics);
    }
  }

  getContainer(): Container {
    return this.container;
  }

  update(
    deltaTime: number,
    cameraWorldX: number,
    cameraWorldY: number,
    cameraScale: number,
    screenWidth: number,
    screenHeight: number,
    shakeOffsetX: number = 0,
    shakeOffsetY: number = 0,
    staticCameraMode: boolean = false
  ) {
    // Перемещаем контейнер звезд так, чтобы его центр следовал за камерой
    // Позиция камеры в экранных координатах - это центр экрана
    // Добавляем shake offset для синхронизации с тряской камеры
    this.container.x = screenWidth / 2 + shakeOffsetX;
    this.container.y = screenHeight / 2 + shakeOffsetY;

    // Обновляем звезды и удаляем истекшие
    const expiredIndices: number[] = [];

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      if (star === undefined) continue;

      star.update(
        deltaTime,
        cameraWorldX,
        cameraWorldY,
        cameraScale,
        screenWidth,
        screenHeight,
        this.scaleInfluence,
        this.baseScale,
        staticCameraMode
      );

      if (star.isExpired()) {
        expiredIndices.push(i);
      }
    }

    // Удаляем истекшие звезды и создаем новые
    for (let i = expiredIndices.length - 1; i >= 0; i--) {
      const index = expiredIndices[i];
      if (index === undefined) continue;

      const star = this.stars[index];
      if (star === undefined) continue;

      this.container.removeChild(star.graphics);
      this.stars.splice(index, 1);

      // Создаем новую звезду на случайной позиции относительно камеры
      // Сначала создаем звезду, чтобы узнать её parallaxFactor
      const viewWorldWidth = screenWidth / this.baseScale;
      const viewWorldHeight = screenHeight / this.baseScale;

      // Создаем звезду с временной позицией
      const newStar = new Star(0, 0);
      const parallaxFactor = newStar.parallaxFactor;

      // Для звезд с маленьким parallaxFactor нужна большая область генерации
      // чтобы они покрывали весь экран после применения параллакса
      // Если parallaxFactor = 0.1, то область должна быть в 10 раз больше
      const effectiveScale = this.baseScale + (cameraScale - this.baseScale) * parallaxFactor * this.scaleInfluence;
      // Вычисляем размер области генерации так, чтобы после применения параллакса
      // звезда могла появиться в любой точке экрана
      const generationWorldWidth = (viewWorldWidth * 2) / (parallaxFactor * effectiveScale / cameraScale);
      const generationWorldHeight = (viewWorldHeight * 2) / (parallaxFactor * effectiveScale / cameraScale);

      // Генерируем позицию звезды в области вокруг камеры с учетом parallaxFactor
      newStar.x = cameraWorldX + (Math.random() - 0.5) * generationWorldWidth;
      newStar.y = cameraWorldY + (Math.random() - 0.5) * generationWorldHeight;

      this.stars.push(newStar);
      this.container.addChild(newStar.graphics);
    }
  }
}
