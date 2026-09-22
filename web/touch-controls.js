(() => {
  "use strict";

  // Layout values are intentionally centralized here. Distances and sizes use
  // vmin so the HUD scales consistently across portrait/landscape phones.
  const TOUCH_CONFIG = {
    opacity: 0.66,
    transitionMs: 200,
    pollMs: 140,
    deadZone: 0.12,
    knobTravel: 0.40,
    haptics: true,

    // Sized against a typical 800-900 x 430-500 landscape phone:
    // joystick ~110-125px, action buttons ~58-65px,
    // steering ~65-72px, pedals ~78-85px and utility ~38-42px.
    joystick: { size: 24.5, knob: 10.5, left: 3.0, bottom: 4.0 },
    steering: { size: 14.5, gap: 1.6, left: 3.0, bottom: 5.0 },
    horn: { size: 8.5, left: 27.0, bottom: 21.0 },

    sprint: { size: 13.0, right: 3.5, bottom: 13.5 },
    action: { size: 13.0, right: 17.0, bottom: 28.0 },

    accelerate: { size: 17.0, right: 3.5, bottom: 12.0 },
    brake: { size: 17.0, right: 21.5, bottom: 12.0 },
    handbrake: { size: 10.5, right: 35.0, bottom: 28.0 },

    fire: { size: 11.0, right: 3.0, top: 12.0 },
    utility: { size: 8.5, gap: 1.5, right: 2.5, bottom: 2.0 },

    radar: { size: 15.0, left: 2.0, top: 2.0 },
    stats: { right: 2.2, top: 2.0 },

    // Explicit desktop/Chromebook sizes prevent touch targets from becoming
    // visually tiny in short or unusually proportioned PC browser windows.
    desktopPx: {
      joystick: 180,
      joystickKnob: 78,
      steering: 104,
      horn: 62,
      sprint: 92,
      action: 92,
      accelerate: 116,
      brake: 116,
      handbrake: 72,
      fire: 80,
      utility: 58,
      radar: 92,
    },
  };

  const CONTROL = Object.freeze({
    LEFT_X: 0,
    LEFT_Y: 1,
    CROSS: 2,
    SQUARE: 3,
    TRIANGLE: 4,
    CIRCLE: 5,
    R1: 6,
    L1: 7,
    LSHOCK: 8,
    SELECT: 9,
    START: 10,
    R2: 11,
    L2: 12,
  });

  const ICONS = {
    run: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14.6" cy="4.3" r="2" fill="currentColor" stroke="none"/><path d="m11.4 8.1 3.5 2.1 3.2.5M11.4 8.1 8.7 12l-3.5 1.1m8.3-2.8-2.1 4.1-4 4.3m4-4.3 4.6 4.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    jump: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5 8 4.5l3 3M8 4.8v5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.7" cy="5.3" r="1.8" fill="currentColor" stroke="none"/><path d="m13.3 9 2.7 2.2 3.4-.4m-6.1-1.8-2.7 3.6 3.1 2.2 2.1-3m-2.1 3-3 4.1m3-4.1 4.1 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    car: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.4 10.2 1.7-4h9.8l1.7 4 1.5 1.4v5.7h-2.2v-1.8H6.1v1.8H3.9v-5.7l1.5-1.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6.2 10.2h11.6M6.7 13.1h2.2m6.2 0h2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    exit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 16.2V9.7l1.4-3.5h8.3l1.1 2.6M6.5 12.2h5.7M6.3 15h2.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 15.4h7m0 0-2.5-2.5m2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    fist: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 11V7.6a1.7 1.7 0 0 1 3.4 0v2.2-4a1.7 1.7 0 0 1 3.4 0v4.1-2.8a1.7 1.7 0 0 1 3.4 0v5.1c0 4.5-2.7 7.3-6.5 7.3-3.4 0-6.1-2.4-7-5.5l-.7-2.4A1.7 1.7 0 0 1 6.2 10l2 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    gun: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 9.3h10.5l4.7 2.5-1.9 2.5h-5.1L10 19H6.7l1.6-4.7H3.2V9.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 9.3V7.2h3.8M5 11.6h4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    gas: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 5.1h5.4l2.4 13.8H6.9L9.3 5.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.2 9h3.6m-4.2 3h4.8m-5.3 3h5.8M12 3v3m0-3-2 2m2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    brake: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 5.1h5.4l2.4 13.8H6.9L9.3 5.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.4 10h5.2m-4.7 3h4.2m-3.7 3h3.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    handbrake: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17.5h9.1l3.7-8.3h1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m13.6 17.5 2.9 2M4 15.2v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    horn: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13h4l6 4V7l-6 4h-4v2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16.4 9.1c1.8 1.5 1.8 4.3 0 5.8m2.4-8.1c3.1 2.9 3.1 7.5 0 10.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="4" y="4" width="4" height="4" rx=".7"/><rect x="10" y="4" width="4" height="4" rx=".7"/><rect x="16" y="4" width="4" height="4" rx=".7"/><rect x="4" y="10" width="4" height="4" rx=".7"/><rect x="10" y="10" width="4" height="4" rx=".7"/><rect x="16" y="10" width="4" height="4" rx=".7"/><rect x="4" y="16" width="4" height="4" rx=".7"/><rect x="10" y="16" width="4" height="4" rx=".7"/><rect x="16" y="16" width="4" height="4" rx=".7"/></g></svg>`,
    map: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.8 5.8 5-2.1 6.2 2.1 5.2-2.1v14.5l-5.2 2.1-6.2-2.1-5 2.1V5.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.8 3.7v14.5M15 5.8v14.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`,
    left: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.8 4.8-7.2 7.2 7.2 7.2" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    right: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.2 4.8 7.2 7.2-7.2 7.2" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  const vmin = n => `${n}vmin`;
  const clampSensitivity = value => Math.max(50, Math.min(200, Number(value) || 100));
  let touchSensitivity = (() => {
    try {
      return clampSensitivity(window.GTA3_TOUCH_SENSITIVITY || localStorage.getItem("gta3.touchSensitivity") || 100);
    } catch {
      return 100;
    }
  })();
  const sensitivityMagnitude = magnitude => {
    const ratio = touchSensitivity / 100;
    const exponent = ratio >= 1
      ? 1 / (1 + (ratio - 1) * 0.9)
      : 1 + (1 - ratio) * 1.4;
    return Math.pow(Math.max(0, Math.min(1, magnitude)), exponent);
  };
  const pulseHaptic = () => {
    if (!TOUCH_CONFIG.haptics || typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(8); } catch {}
  };
  const isDesktopHUD = () =>
    matchMedia("(hover:hover) and (pointer:fine)").matches ||
    Math.min(window.innerWidth || 0, window.innerHeight || 0) >= 700;
  const controlSize = (vminSize, desktopPx) =>
    isDesktopHUD() && desktopPx ? `${desktopPx}px` : vmin(vminSize);

  class TouchBridge {
    constructor() {
      this.module = null;
      this.setFn = null;
      this.resetFn = null;
      this.contextFn = null;
      this.weaponFn = null;
      this.healthFn = null;
      this.wantedFn = null;
      this.cashFn = null;
      this.clockFn = null;
    }

    connect() {
      const mod = window.re3Module;
      if (!mod || typeof mod.cwrap !== "function") return false;
      if (this.module === mod && this.setFn) return true;
      try {
        this.module = mod;
        this.setFn = mod.cwrap("re3_BrowserTouchSet", null, ["number", "number"]);
        this.resetFn = mod.cwrap("re3_BrowserTouchReset", null, []);
        this.contextFn = mod.cwrap("re3_BrowserTouchGetContext", "number", []);
        this.weaponFn = mod.cwrap("re3_BrowserTouchGetWeaponType", "number", []);
        this.healthFn = mod.cwrap("re3_BrowserTouchGetHealth", "number", []);
        this.wantedFn = mod.cwrap("re3_BrowserTouchGetWanted", "number", []);
        this.cashFn = mod.cwrap("re3_BrowserTouchGetCash", "number", []);
        this.clockFn = mod.cwrap("re3_BrowserTouchGetClock", "number", []);
        return true;
      } catch (err) {
        console.warn("[touch] native bridge unavailable", err);
        this.setFn = null;
        return false;
      }
    }

    set(control, value) {
      if (!this.setFn && !this.connect()) return;
      this.setFn(control, value);
    }

    reset() {
      if (!this.resetFn && !this.connect()) return;
      this.resetFn();
    }

    readStatus() {
      if (!this.connect()) return null;
      try {
        return {
          context: this.contextFn(),
          weapon: this.weaponFn(),
          health: this.healthFn(),
          wanted: this.wantedFn(),
          cash: this.cashFn(),
          clock: this.clockFn(),
        };
      } catch {
        return null;
      }
    }
  }

  class TouchButton {
    constructor({ parent, className = "", icon = "", label = "", shortLabel = "", onPress, onRelease }) {
      this.onPress = onPress || (() => {});
      this.onRelease = onRelease || (() => {});
      this.pointers = new Set();
      this.box = null;
      this.desktopPx = null;
      this.el = document.createElement("button");
      this.el.type = "button";
      this.el.className = `touch-control-btn ${className}`;
      this.el.innerHTML = icon;
      this.el.setAttribute("aria-label", label);
      if (shortLabel) this.el.dataset.shortLabel = shortLabel;
      parent.appendChild(this.el);
      this.bind();
    }

    bind() {
      this.el.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.el.setPointerCapture?.(e.pointerId);
        this.pointers.add(e.pointerId);
        this.el.classList.add("is-pressed");
        if (this.pointers.size === 1) {
          pulseHaptic();
          this.onPress(e);
        }
      });
      const release = e => {
        if (!this.pointers.has(e.pointerId)) return;
        e.preventDefault();
        e.stopPropagation();
        this.pointers.delete(e.pointerId);
        if (this.pointers.size === 0) {
          this.el.classList.remove("is-pressed");
          this.onRelease(e);
        }
      };
      this.el.addEventListener("pointerup", release);
      this.el.addEventListener("pointercancel", release);
      this.el.addEventListener("lostpointercapture", release);
      this.el.addEventListener("contextmenu", e => e.preventDefault());
    }

    setIcon(html, label) {
      this.el.innerHTML = html;
      if (label) this.el.setAttribute("aria-label", label);
    }

    setBox(box, desktopPx = null) {
      this.box = box;
      this.desktopPx = desktopPx;
      this.refreshBox();
    }

    refreshBox() {
      if (!this.box) return;
      const { size, left, right, top, bottom } = this.box;
      if (size != null) {
        const value = controlSize(size, this.desktopPx);
        this.el.style.width = value;
        this.el.style.height = value;
      }
      this.el.style.left = left != null ? vmin(left) : "";
      this.el.style.right = right != null ? vmin(right) : "";
      this.el.style.top = top != null ? vmin(top) : "";
      this.el.style.bottom = bottom != null ? vmin(bottom) : "";
    }

    forceRelease() {
      if (this.pointers.size > 0) {
        this.pointers.clear();
        this.el.classList.remove("is-pressed");
        this.onRelease({ forced: true });
      }
    }
  }

  class Joystick {
    constructor(parent, bridge) {
      this.bridge = bridge;
      this.pointerId = null;
      this.base = document.createElement("div");
      this.base.className = "touch-joystick on-foot-control";
      this.knob = document.createElement("div");
      this.knob.className = "touch-joystick-knob";
      this.base.appendChild(this.knob);
      parent.appendChild(this.base);
      this.refreshLayout();
      this.bind();
    }

    bind() {
      this.base.addEventListener("pointerdown", e => {
        if (this.pointerId !== null) return;
        e.preventDefault();
        e.stopPropagation();
        this.pointerId = e.pointerId;
        this.base.setPointerCapture?.(e.pointerId);
        this.update(e);
      });
      this.base.addEventListener("pointermove", e => {
        if (e.pointerId !== this.pointerId) return;
        e.preventDefault();
        this.update(e);
      });
      const end = e => {
        if (e.pointerId !== this.pointerId) return;
        e.preventDefault();
        this.pointerId = null;
        this.knob.style.transform = "translate(-50%,-50%)";
        this.bridge.set(CONTROL.LEFT_X, 0);
        this.bridge.set(CONTROL.LEFT_Y, 0);
      };
      this.base.addEventListener("pointerup", end);
      this.base.addEventListener("pointercancel", end);
      this.base.addEventListener("lostpointercapture", end);
    }

    update(e) {
      const r = this.base.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const max = r.width * TOUCH_CONFIG.knobTravel;
      const rawLen = Math.hypot(dx, dy);
      const len = rawLen || 1;
      const visualScale = Math.min(1, max / len);
      const px = dx * visualScale;
      const py = dy * visualScale;

      const rawMagnitude = Math.min(1, rawLen / max);
      const deadZone = TOUCH_CONFIG.deadZone;
      let outputMagnitude = 0;
      if (rawMagnitude > deadZone) {
        const normalized = (rawMagnitude - deadZone) / (1 - deadZone);
        outputMagnitude = sensitivityMagnitude(normalized);
      }

      const dirX = rawLen > 0 ? dx / rawLen : 0;
      const dirY = rawLen > 0 ? dy / rawLen : 0;
      const sx = dirX * outputMagnitude;
      const sy = dirY * outputMagnitude;

      this.base.classList.toggle("is-active", rawMagnitude > deadZone);
      this.knob.style.transform = `translate(calc(-50% + ${px}px),calc(-50% + ${py}px))`;
      this.bridge.set(CONTROL.LEFT_X, Math.round(sx * 127));
      this.bridge.set(CONTROL.LEFT_Y, Math.round(sy * 127));
    }

    refreshLayout() {
      const cfg = TOUCH_CONFIG.joystick;
      this.base.style.width = this.base.style.height = controlSize(cfg.size, TOUCH_CONFIG.desktopPx.joystick);
      this.base.style.left = vmin(cfg.left);
      this.base.style.bottom = vmin(cfg.bottom);
      this.knob.style.width = this.knob.style.height = controlSize(cfg.knob, TOUCH_CONFIG.desktopPx.joystickKnob);
    }

    reset() {
      this.pointerId = null;
      this.base.classList.remove("is-active");
      this.knob.style.transform = "translate(-50%,-50%)";
      this.bridge.set(CONTROL.LEFT_X, 0);
      this.bridge.set(CONTROL.LEFT_Y, 0);
    }
  }

  class SteeringPair {
    constructor(parent, bridge) {
      this.bridge = bridge;
      this.leftDown = false;
      this.rightDown = false;
      this.wrap = document.createElement("div");
      this.wrap.className = "touch-steering vehicle-control";
      parent.appendChild(this.wrap);

      const cfg = TOUCH_CONFIG.steering;

      this.left = new TouchButton({
        parent: this.wrap,
        className: "touch-steer-btn",
        icon: ICONS.left,
        label: "Steer left",
        onPress: () => { this.leftDown = true; this.sync(); },
        onRelease: () => { this.leftDown = false; this.sync(); },
      });
      this.right = new TouchButton({
        parent: this.wrap,
        className: "touch-steer-btn",
        icon: ICONS.right,
        label: "Steer right",
        onPress: () => { this.rightDown = true; this.sync(); },
        onRelease: () => { this.rightDown = false; this.sync(); },
      });
      for (const b of [this.left, this.right]) {
        b.el.style.position = "relative";
      }
      this.refreshLayout();
    }

    refreshLayout() {
      const cfg = TOUCH_CONFIG.steering;
      this.wrap.style.left = vmin(cfg.left);
      this.wrap.style.bottom = vmin(cfg.bottom);
      this.wrap.style.gap = vmin(cfg.gap);
      for (const b of [this.left, this.right]) {
        b.el.style.width = b.el.style.height = controlSize(cfg.size, TOUCH_CONFIG.desktopPx.steering);
      }
    }

    sync() {
      let value = 0;
      if (this.leftDown !== this.rightDown) value = this.leftDown ? -127 : 127;
      this.bridge.set(CONTROL.LEFT_X, value);
    }

    reset() {
      this.leftDown = this.rightDown = false;
      this.sync();
    }
  }

  class TouchHUD {
    constructor() {
      this.bridge = new TouchBridge();
      this.mode = "foot";
      this.context = 0;
      this.enabledMode = window.GTA3_TOUCH_CONTROLS_MODE || "auto";
      this.root = null;
      this.statusTimer = 0;
      this.lastStatus = null;
      this.build();
      this.bindGlobal();
      this.refreshVisibility();
      this.startPolling();
    }

    build() {
      const gameWindow = document.getElementById("game-window");
      if (!gameWindow || document.getElementById("gta3-touch-hud")) return;

      const root = document.createElement("div");
      root.id = "gta3-touch-hud";
      root.className = "touch-hud mode-foot";
      root.style.setProperty("--touch-opacity", String(TOUCH_CONFIG.opacity));
      root.style.setProperty("--touch-transition", `${TOUCH_CONFIG.transitionMs}ms`);
      gameWindow.appendChild(root);
      this.root = root;

      // Informational HUD frames. The native GTA HUD remains visible through them.
      this.radar = document.createElement("div");
      this.radar.className = "touch-radar-frame";
      this.radar.innerHTML = '<span class="touch-radar-n">N</span>';
      const rc = TOUCH_CONFIG.radar;
      const radarSize = controlSize(rc.size, TOUCH_CONFIG.desktopPx.radar);
      Object.assign(this.radar.style, { width:radarSize, height:radarSize, left:vmin(rc.left), top:vmin(rc.top) });
      root.appendChild(this.radar);

      this.stats = document.createElement("div");
      this.stats.className = "touch-stats";
      this.stats.style.right = vmin(TOUCH_CONFIG.stats.right);
      this.stats.style.top = vmin(TOUCH_CONFIG.stats.top);
      this.stats.innerHTML = `
        <div class="touch-stat-time">--:--</div>
        <div class="touch-stat-cash">$00000000</div>
        <div class="touch-stat-health">♥ <span>100</span></div>
        <div class="touch-stat-stars">☆☆☆☆☆☆</div>`;
      root.appendChild(this.stats);

      this.joystick = new Joystick(root, this.bridge);
      this.steering = new SteeringPair(root, this.bridge);

      this.sprint = this.makeHold("on-foot-control sprint-btn", ICONS.run, "Sprint", CONTROL.CROSS, TOUCH_CONFIG.sprint, "RUN");
      this.action = new TouchButton({
        parent: root,
        className: "touch-action-btn",
        icon: ICONS.jump,
        label: "Jump or context action",
        shortLabel: "ACTION",
        onPress: () => this.pressAction(true),
        onRelease: () => this.pressAction(false),
      });
      this.action.setBox(TOUCH_CONFIG.action, TOUCH_CONFIG.desktopPx.action);

      this.accelerate = this.makeHold("vehicle-control accelerate-btn", ICONS.gas, "Accelerate", CONTROL.CROSS, TOUCH_CONFIG.accelerate, "GAS");
      this.brake = this.makeHold("vehicle-control brake-btn", ICONS.brake, "Brake or reverse", CONTROL.SQUARE, TOUCH_CONFIG.brake, "BRAKE");
      this.handbrake = this.makeHold("vehicle-control handbrake-btn", ICONS.handbrake, "Handbrake", CONTROL.R1, TOUCH_CONFIG.handbrake, "HB");
      this.horn = this.makeHold("vehicle-control horn-btn", ICONS.horn, "Horn", CONTROL.LSHOCK, TOUCH_CONFIG.horn, "HORN");

      this.fire = this.makeHold("touch-fire-btn", ICONS.fist, "Attack or fire", CONTROL.CIRCLE, TOUCH_CONFIG.fire, "FIRE");

      this.utility = document.createElement("div");
      this.utility.className = "touch-utility";
      this.utility.style.right = vmin(TOUCH_CONFIG.utility.right);
      this.utility.style.bottom = vmin(TOUCH_CONFIG.utility.bottom);
      this.utility.style.gap = vmin(TOUCH_CONFIG.utility.gap);
      root.appendChild(this.utility);

      this.weaponCycle = this.makeTapIn(this.utility, ICONS.grid, "Cycle weapon", CONTROL.R2);
      this.pause = this.makeTapIn(this.utility, ICONS.map, "Pause or menu", CONTROL.START);
      for (const b of [this.weaponCycle, this.pause]) {
        b.el.style.position = "relative";
        b.el.style.width = b.el.style.height = controlSize(TOUCH_CONFIG.utility.size, TOUCH_CONFIG.desktopPx.utility);
      }
    }

    makeHold(className, icon, label, control, box, shortLabel = "") {
      const b = new TouchButton({
        parent: this.root,
        className,
        icon,
        label,
        shortLabel,
        onPress: () => this.bridge.set(control, 1),
        onRelease: () => this.bridge.set(control, 0),
      });
      const desktopKey = className.includes("accelerate-btn") ? "accelerate"
        : className.includes("brake-btn") ? "brake"
        : className.includes("handbrake-btn") ? "handbrake"
        : className.includes("horn-btn") ? "horn"
        : className.includes("sprint-btn") ? "sprint"
        : className.includes("touch-fire-btn") ? "fire"
        : null;
      b.setBox(box, desktopKey ? TOUCH_CONFIG.desktopPx[desktopKey] : null);
      return b;
    }

    makeTapIn(parent, icon, label, control) {
      return new TouchButton({
        parent,
        className: "touch-utility-btn",
        icon,
        label,
        onPress: () => this.bridge.set(control, 1),
        onRelease: () => this.bridge.set(control, 0),
      });
    }

    pressAction(down) {
      const control = (this.mode === "vehicle" || this.context === 1) ? CONTROL.TRIANGLE : CONTROL.SQUARE;
      this.bridge.set(control, down ? 1 : 0);
    }

    bindGlobal() {
      window.addEventListener("gta3-launcher-ready", () => this.bridge.connect());
      window.addEventListener("gta3-touch-controls-change", e => {
        this.enabledMode = e.detail?.mode || "auto";
        this.refreshVisibility();
      });
      window.addEventListener("gta3-touch-sensitivity-change", e => {
        touchSensitivity = clampSensitivity(e.detail?.value);
      });
      window.addEventListener("resize", () => {
        this.refreshVisibility();
        this.refreshLayout();
      });
      window.addEventListener("orientationchange", () => {
        window.setTimeout(() => this.refreshLayout(), 120);
      });
      window.addEventListener("blur", () => this.resetAll());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.resetAll();
      });
    }

    isTouchEnvironment() {
      return navigator.maxTouchPoints > 0 || matchMedia("(pointer:coarse)").matches;
    }

    refreshLayout() {
      this.joystick?.refreshLayout();
      this.steering?.refreshLayout();

      const radarSize = controlSize(TOUCH_CONFIG.radar.size, TOUCH_CONFIG.desktopPx.radar);
      if (this.radar) {
        this.radar.style.width = radarSize;
        this.radar.style.height = radarSize;
      }

      for (const button of [
        this.sprint, this.action, this.accelerate, this.brake,
        this.handbrake, this.horn, this.fire, this.weaponCycle, this.pause
      ]) {
        button?.refreshBox?.();
      }

      for (const button of [this.weaponCycle, this.pause]) {
        if (button?.el) {
          const size = controlSize(TOUCH_CONFIG.utility.size, TOUCH_CONFIG.desktopPx.utility);
          button.el.style.width = size;
          button.el.style.height = size;
        }
      }
    }

    refreshVisibility() {
      if (!this.root) return;
      // AUTO must remain visible in the dedicated game window even on
      // Chromebooks/touch laptops that report a fine pointer. Users can still
      // explicitly hide the HUD with the OFF setting.
      const enabled = this.enabledMode !== "off";
      this.root.classList.toggle("touch-disabled", !enabled);
      this.root.setAttribute("aria-hidden", enabled ? "false" : "true");
    }

    startPolling() {
      const tick = () => {
        const status = this.bridge.readStatus();
        if (status) this.applyStatus(status);
      };
      tick();
      this.statusTimer = window.setInterval(tick, TOUCH_CONFIG.pollMs);
    }

    applyStatus(status) {
      this.lastStatus = status;
      this.context = status.context | 0;
      const nextMode = this.context === 2 ? "vehicle" : "foot";
      if (nextMode !== this.mode) this.setMode(nextMode);

      if (this.mode === "vehicle") {
        this.action.setIcon(ICONS.exit, "Exit vehicle");
      } else if (this.context === 1) {
        this.action.setIcon(ICONS.car, "Enter nearby vehicle");
      } else {
        this.action.setIcon(ICONS.jump, "Jump");
      }

      this.fire.setIcon(status.weapon > 0 ? ICONS.gun : ICONS.fist, status.weapon > 0 ? "Fire weapon" : "Attack");

      const clock = String(Math.max(0, status.clock | 0)).padStart(4, "0");
      const hh = clock.slice(0, 2);
      const mm = clock.slice(2, 4);
      this.stats.querySelector(".touch-stat-time").textContent = `${hh}:${mm}`;
      this.stats.querySelector(".touch-stat-cash").textContent = `$${String(Math.max(0, status.cash | 0)).padStart(8, "0")}`;
      this.stats.querySelector(".touch-stat-health span").textContent = String(Math.max(0, status.health | 0)).padStart(3, "0");
      const wanted = Math.max(0, Math.min(6, status.wanted | 0));
      this.stats.querySelector(".touch-stat-stars").textContent = "★".repeat(wanted) + "☆".repeat(6 - wanted);
    }

    setMode(mode) {
      this.resetAll();
      this.mode = mode;
      this.root.classList.toggle("mode-foot", mode === "foot");
      this.root.classList.toggle("mode-vehicle", mode === "vehicle");
    }

    resetAll() {
      this.bridge.reset();
      this.joystick?.reset();
      this.steering?.reset();
      for (const button of [
        this.sprint, this.action, this.accelerate, this.brake,
        this.handbrake, this.horn, this.fire, this.weaponCycle, this.pause
      ]) {
        button?.forceRelease?.();
      }
      this.root?.querySelectorAll(".is-pressed").forEach(el => el.classList.remove("is-pressed"));
    }
  }

  function bootTouchHUD() {
    if (document.getElementById("gta3-touch-hud")) return;
    new TouchHUD();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootTouchHUD, { once:true });
  } else {
    bootTouchHUD();
  }

  window.GTA3TouchControls = { TOUCH_CONFIG, CONTROL };
})();
