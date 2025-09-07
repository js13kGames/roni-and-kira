import "./styles.css";
import { detectSwipe } from "../../../../utils/detectSwipe";
import { PlaySound } from "../../../../utils/sounds";
import { saveLevelCache } from "../../../../levels";
import {
  addClass,
  delay,
  hasClass,
  isFirefoxBrowser,
  qs,
  removeClass,
  setCssVariable,
  setHtml,
} from "../../../../utils/helpers";
import {
  BASE_WIDTH_TILE,
  CAT_SPEED,
  ECatColor,
  EDirections,
  ESounds,
  ETiles,
  HANDLE_GRID_ACTION,
  ROUTER_COMPONENT,
} from "../../../../utils/constants";
import {
  calculatePosition,
  getTileByType,
  validateMoveCat,
  valiteCollectAllKeys,
} from "./helpers";
import Alert from "../../../../components/alert";
import type {
  Cat,
  CatElemet,
  GridActionDetail,
  IBoardKeys,
  Level,
  TCatColor,
  Tiles,
} from "../../../../interfaces";

const BASE_CLASS = "cat";
const CAT_BLACK_CLASS = `.${BASE_CLASS}-black`;
const CAT_YELLOW_CLASS = `.${BASE_CLASS}-yellow`;
const BASE_TILE_CLASS = "#t-";

const CLASS_NAMES = {
  EXPLODE: "explode",
  COIN: "coin",
  OPEN: "open",
  ANI: "ani",
};

class GridGame extends HTMLElement {
  // Estado interno de monedas recolectadas
  private boardCoins = { total: 0, collected: 0 };
  // Estado interno de llaves recolectadas
  private boardKeys: IBoardKeys = { total: 0, collected: 0 };
  // Referencias a los elementos DOM de los gatos
  private _cats: CatElemet | null = null;
  // Datos del nivel actual
  private level: Level | null = null;
  // Tamaño de cada tile en píxeles
  private size: number = 0;
  // Número de movimientos que hizo el gato en el turno
  private totalCatMove: number = 0;
  // Flag para saber si ya se recogieron todas las llaves
  private collectAllKeys: boolean = false;
  private levelNumber: number = 0;
  private isFirefox = false;

  // Setter para recibir los datos del nivel desde afuera
  set levelData(value: { level: Level; levelNumber: number }) {
    this.level = value.level;
    this.levelNumber = value.levelNumber;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  /**
   * Renderiza el tablero completo
   */
  private render() {
    if (!this.level) return;

    this.isFirefox = isFirefoxBrowser();

    // Calcula el tamaño en base al ancho del nivel
    this.size = Math.round(BASE_WIDTH_TILE / this.level.width);

    // Inicializa monedas y llaves
    this.boardCoins = {
      total: getTileByType(ETiles.COIN, this.level.tiles).length,
      collected: 0,
    };

    this.boardKeys = {
      total: getTileByType(ETiles.KEYS, this.level.tiles).length,
      collected: 0,
    };

    this.collectAllKeys = false;

    const width = this.level.width * this.size;
    const height = this.level.height * this.size;

    // Inyecta el HTML del grid
    setHtml(this, this.renderGrid(width, height));

    // Referencia a los gatos en el DOM
    this._cats = {
      [ECatColor.BLACK]: qs(this, CAT_BLACK_CLASS) as HTMLButtonElement,
      [ECatColor.YELLOW]: qs(this, CAT_YELLOW_CLASS) as HTMLButtonElement,
    };

    // Detecta gestos de swipe en cada gato
    [ECatColor.BLACK, ECatColor.YELLOW].forEach((color) => {
      const cat = this._cats?.[color];
      if (cat) {
        detectSwipe(cat, {
          onSwipe: (dir) => this.moveCat(color, dir),
        });
      }
    });
  }

  /**
   * Intenta mover un gato en la dirección indicada
   */
  moveCat(color: TCatColor, dir: EDirections) {
    if (!this.level) return;

    const { copyLevel, catMove } = validateMoveCat(
      this.level,
      color,
      dir,
      this.boardKeys
    );

    // Actualiza el nivel y movimientos
    this.level = copyLevel;
    this.totalCatMove = catMove;

    if (this.totalCatMove >= 1) {
      this.updateCats(color);
    }
  }

  /**
   * Actualiza las monedas y llaves recolectadas visualmente
   */
  updateCoins() {
    if (!this.level) return;

    [
      ...getTileByType(ETiles.COIN, this.level.tiles),
      ...getTileByType(ETiles.KEYS, this.level.tiles),
    ].forEach(async (tile) => {
      const element = qs(
        this,
        `${BASE_TILE_CLASS}${tile.position.x}-${tile.position.y}`
      ) as HTMLElement;

      // Cuando se oculta un tile, dispara la animación
      if (tile.hide && !hasClass(element, CLASS_NAMES.COIN)) {
        addClass(element, CLASS_NAMES.COIN);
        const delayAnimation = (tile.delay || 0) * CAT_SPEED;
        setCssVariable(element, "s", `${delayAnimation}ms`);

        if (tile.type === ETiles.COIN) {
          this.boardCoins.collected++;
        } else {
          this.boardKeys.collected++;
        }

        await delay(delayAnimation);
        PlaySound(tile.type === ETiles.COIN ? ESounds.COIN : ESounds.KEY);
      }
    });
  }

  /**
   * Actualiza las cajas destruidas
   */
  updateBoxes() {
    if (!this.level) return;

    getTileByType(ETiles.BOXES, this.level.tiles).forEach((tile) => {
      const element = qs(
        this,
        `${BASE_TILE_CLASS}${tile.position.x}-${tile.position.y}`
      ) as HTMLElement;

      if (tile.hide && !hasClass(element, CLASS_NAMES.EXPLODE)) {
        addClass(element, CLASS_NAMES.EXPLODE);
        PlaySound(ESounds.DESTROY);
      }
    });
  }

  /**
   * Abre puertas cuando se recolectan todas las llaves
   */
  updateDoors() {
    if (!this.level || this.boardKeys.total === 0 || this.collectAllKeys)
      return;

    this.collectAllKeys = valiteCollectAllKeys(this.boardKeys);

    if (this.collectAllKeys) {
      getTileByType(ETiles.GATES, this.level.tiles).forEach((tile) => {
        const element = qs(
          this,
          `${BASE_TILE_CLASS}${tile.position.x}-${tile.position.y}`
        ) as HTMLElement;

        if (!hasClass(element, CLASS_NAMES.OPEN)) {
          addClass(element, CLASS_NAMES.OPEN);
        }
      });

      PlaySound(ESounds.OPEN);
    }
  }

  /**
   * Ejecuta las animaciones de los gatos en el tablero
   */
  async updateCats(color: TCatColor) {
    const catElemet = this._cats?.[color];

    if (!this.level || !catElemet) return;

    /**
     * Se obtiene el valor del gato...
     */
    const cat = this.level.cats.find((v) => v.color === color);

    /**
     * Valida qu eexista el gato...
     */
    if (!cat) return;

    PlaySound(ESounds.SWIPE);
    this.disabledCats(true);
    this.updateCoins();

    // Se añade clase de animación
    addClass(catElemet, CLASS_NAMES.ANI);

    const { x, y } = calculatePosition(cat.position, this.size);

    // Variables CSS para animación
    setCssVariable(catElemet, "x", x);
    setCssVariable(catElemet, "y", y);
    setCssVariable(catElemet, "s", `${CAT_SPEED * this.totalCatMove}ms`);

    // Espera que terminen todas las animaciones CSS
    const animations = catElemet.getAnimations().map((a) => a.finished);
    await Promise.allSettled(animations);

    // Resetea estado del gato
    removeClass(catElemet, CLASS_NAMES.ANI);

    if (cat.destroy && !this.collectAllCoins()) {
      // GAME OVER: el gato fue destruido
      addClass(catElemet, CLASS_NAMES.EXPLODE);
      PlaySound(ESounds.EXPLODE);

      // Mostrar la ventana de game over...
      await delay(300);
      this.showModal(true);
      PlaySound(ESounds.GAME_OVER);
    } else {
      this.disabledCats(false);
    }

    this.valideGameOver();
    this.updateBoxes();
    this.updateDoors();
  }

  /**
   * Verifica si se completó el nivel (todas las monedas recolectadas)
   */
  async valideGameOver() {
    if (this.collectAllCoins()) {
      this.disabledCats(true);
      // Guardar el nivel completado en localStorage
      saveLevelCache(this.levelNumber);

      await delay(200);
      this.showModal();
      PlaySound(ESounds.SUCESS);
    }
  }

  showModal(isExplode = false) {
    const data = {
      icon: isExplode ? "😿" : "😺",
      txt: isExplode
        ? "Ouch! Try again."
        : "Level Complete! Get ready for the next one.",
      no: "Home",
      yes: isExplode ? "Restart" : "Next Level",
    };

    Alert.show({
      ...data,
      cb: (success) => {
        this.dispatchEvent(
          new CustomEvent<GridActionDetail>(HANDLE_GRID_ACTION, {
            detail: { success, isExplode },
            bubbles: true,
            composed: true,
          })
        );
      },
    });
  }

  /**
   * Revisa si ya se recolectaron todas las monedas
   */
  collectAllCoins() {
    return this.boardCoins.total === this.boardCoins.collected;
  }

  /**
   * Habilita o deshabilita la interacción con los gatos
   */
  disabledCats(disabled = false) {
    if (!this.level) return;

    this.level.cats.forEach((cat) => {
      const catElemet = this._cats?.[cat.color];
      if (catElemet) {
        catElemet.disabled = disabled;
      }
    });
  }

  /**
   * Renderiza la grilla principal
   */
  renderGrid(width = 0, height = 0) {
    if (!this.level) return "";

    return /*html*/ `<div class="gg bri ${
      this.isFirefox ? "firefox" : "normal"
    }" style="--si:${
      this.size
    }px;width:${width}px;height:${height}px">${this.renderTiles(
      this.level.tiles
    )}${this.renderCats(this.level.cats)}</div>`;
  }

  /**
   * Renderiza cada tile del tablero
   */
  renderTiles(tiles: Tiles[]) {
    return tiles
      .map(({ type, position }) => {
        const { x, y } = calculatePosition(position, this.size);
        return /*html*/ `<div ${
          type !== ETiles.BRICK && type !== ETiles.SPIKE
            ? `id="t-${position.x}-${position.y}"`
            : ""
        } class="tile tile-${type} ${type === 0 ? "bri" : ""}" style="--si:${
          this.size
        }px;left:${x};top:${y}"></div>`;
      })
      .join("");
  }

  /**
   * Renderiza los gatos iniciales
   */
  renderCats(cats: Cat[]) {
    return cats
      .map(({ color, position }) => {
        const { x, y } = calculatePosition(position, this.size);
        return /*html*/ `<button class="cat cat-${color.toLowerCase()}" style="--si:${
          this.size
        }px;--x:${x};--y:${y};"></button>`;
      })
      .join("");
  }
}

customElements.define(ROUTER_COMPONENT.GRID, GridGame);
