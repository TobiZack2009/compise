// §21.9 Game Loop — requires Phase 2 (classes, static fields, private fields, std/math, std/io)
import Math from "std/math";
import { console } from "std/io";

class Vec2 {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
}

class Player {
  #pos; #vel; #health;
  name;

  constructor(name = "", x = 0.0, y = 0.0) {
    this.name = name;
    this.#pos = new Vec2(x, y);
    this.#vel = new Vec2;
    this.#health = 100;
  }

  get pos()    { return this.#pos; }
  get health() { return this.#health; }
  get alive()  { return this.#health > 0; }

  move(dx = 0.0, dy = 0.0) { this.#vel.x = dx; this.#vel.y = dy; }

  update(dt = 0.0) {
    this.#pos.x += this.#vel.x * dt;
    this.#pos.y += this.#vel.y * dt;
  }

  damage(amount = 0) {
    this.#health = Math.max(0, this.#health - amount);
  }
}

class Game {
  static #instance;
  static #running = false;

  static init() {
    Game.#instance = new Player("Hero");
    Game.#running = true;
  }

  static update(dt = 0.0)         { if (Game.#running) Game.#instance.update(dt); }
  static move(dx = 0.0, dy = 0.0) { Game.#instance.move(dx, dy); }

  static damage(amount = 0) {
    Game.#instance.damage(amount);
    if (!Game.#instance.alive) {
      Game.#running = false;
      console.log("Game over");
    }
  }

  static get running() { return Game.#running; }
}

//@export("game_init")
function init()                { Game.init(); }
//@export("game_update")
function update(dt = 0.0)     { Game.update(dt); }
//@export("game_move")
function move(dx=0.0, dy=0.0) { Game.move(dx, dy); }
//@export("game_damage")
function damage(amount = 0)   { Game.damage(amount); }
//@export("game_running")
function running()             { return Game.running ? 1 : 0; }
