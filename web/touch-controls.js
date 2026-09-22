(() => {
  "use strict";

  // Layout values are intentionally centralized here. Distances and sizes use
  // vmin so the HUD scales consistently across portrait/landscape phones.
  const TOUCH_CONFIG = {
    opacity: 0.66,
    transitionMs: 200,
    pollMs: 140,

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
    run: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="28" cy="9" r="4"/><path d="M23 17l7 5 7 1m-14-6-6 8-7 2m17-5-5 9-9 8m9-8 8 8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    jump: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="25" cy="9" r="4"/><path d="M23 17l-6 8 8 4 5-8 7 5m-12 3-7 11m7-11 10 9M11 15l6-4 4 5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    car: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 29l4-11h20l4 11v9h-5v-4H15v4h-5v-9Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M15 18l3-6h12l4 6M14 28h5m10 0h5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
    exit: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M27 8H12v32h15M20 24h19m0 0-7-7m7 7-7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    fist: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 24v-8a4 4 0 0 1 8 0v6-10a4 4 0 0 1 8 0v10-7a4 4 0 0 1 8 0v13c0 9-6 14-14 14-7 0-14-5-16-12l-2-7a4 4 0 0 1 7-3l4 6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    gun: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 19h23l9 5-4 6H24l-3 11h-8l4-12H7V19Z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/><path d="M30 19v-5h8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`,
    gas: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 39V10m0 0-10 10m10-10 10 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    brake: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 9v29m0 0-10-10m10 10 10-10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    handbrake: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M15 35V13m18 22V13M18 24h12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
    horn: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 28h8l12 8V12l-12 8H8v8Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M34 18c3 3 3 9 0 12m5-16c6 6 6 14 0 20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`,
    grid: `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor"><rect x="9" y="9" width="8" height="8" rx="1"/><rect x="20" y="9" width="8" height="8" rx="1"/><rect x="31" y="9" width="8" height="8" rx="1"/><rect x="9" y="20" width="8" height="8" rx="1"/><rect x="20" y="20" width="8" height="8" rx="1"/><rect x="31" y="20" width="8" height="8" rx="1"/><rect x="9" y="31" width="8" height="8" rx="1"/><rect x="20" y="31" width="8" height="8" rx="1"/><rect x="31" y="31" width="8" height="8" rx="1"/></g></svg>`,
    map: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 40V19l16-11 16 11v21H8Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M18 40V28h12v12M14 22h4m12 0h4" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
    left: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M31 9 16 24l15 15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    right: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m17 9 15 15-15 15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  const vmin = n => `${n}vmin`;
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
    constructor({ parent, className = "", icon = "", label = "", onPress, onRelease }) {
      this.onPress = onPress || (() => {});
      this.onRelease = onRelease || (() => {});
      this.pointers = new Set();
      this.el = document.createElement("button");
      this.el.type = "button";
      this.el.className = `touch-control-btn ${className}`;
      this.el.innerHTML = icon;
      this.el.setAttribute("aria-label", label);
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
        if (this.pointers.size === 1) this.onPress(e);
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

    setBox({ size, left, right, top, bottom }, desktopPx = null) {
      if (size != null) {
        const value = controlSize(size, desktopPx);
        this.el.style.width = value;
        this.el.style.height = value;
      }
      if (left != null) this.el.style.left = vmin(left);
      if (right != null) this.el.style.right = vmin(right);
      if (top != null) this.el.style.top = vmin(top);
      if (bottom != null) this.el.style.bottom = vmin(bottom);
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
      const cfg = TOUCH_CONFIG.joystick;
      this.base.style.width = this.base.style.height = controlSize(cfg.size, TOUCH_CONFIG.desktopPx.joystick);
      this.base.style.left = vmin(cfg.left);
      this.base.style.bottom = vmin(cfg.bottom);
      this.knob.style.width = this.knob.style.height = controlSize(cfg.knob, TOUCH_CONFIG.desktopPx.joystickKnob);
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
      const max = r.width * 0.37;
      const len = Math.hypot(dx, dy) || 1;
      const scale = Math.min(1, max / len);
      const px = dx * scale;
      const py = dy * scale;
      const nx = Math.max(-1, Math.min(1, px / max));
      const ny = Math.max(-1, Math.min(1, py / max));
      this.knob.style.transform = `translate(calc(-50% + ${px}px),calc(-50% + ${py}px))`;
      this.bridge.set(CONTROL.LEFT_X, Math.round(nx * 127));
      this.bridge.set(CONTROL.LEFT_Y, Math.round(ny * 127));
    }

    reset() {
      this.pointerId = null;
      this.knob.style.transform = "translate(-50%,-50%)";
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
      this.wrap.style.left = vmin(cfg.left);
      this.wrap.style.bottom = vmin(cfg.bottom);
      this.wrap.style.gap = vmin(cfg.gap);

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

      this.sprint = this.makeHold("on-foot-control sprint-btn", ICONS.run, "Sprint", CONTROL.CROSS, TOUCH_CONFIG.sprint);
      this.action = new TouchButton({
        parent: root,
        className: "touch-action-btn",
        icon: ICONS.jump,
        label: "Jump or context action",
        onPress: () => this.pressAction(true),
        onRelease: () => this.pressAction(false),
      });
      this.action.setBox(TOUCH_CONFIG.action, TOUCH_CONFIG.desktopPx.action);

      this.accelerate = this.makeHold("vehicle-control accelerate-btn", ICONS.gas, "Accelerate", CONTROL.CROSS, TOUCH_CONFIG.accelerate);
      this.brake = this.makeHold("vehicle-control brake-btn", ICONS.brake, "Brake or reverse", CONTROL.SQUARE, TOUCH_CONFIG.brake);
      this.handbrake = this.makeHold("vehicle-control handbrake-btn", ICONS.handbrake, "Handbrake", CONTROL.R1, TOUCH_CONFIG.handbrake);
      this.horn = this.makeHold("vehicle-control horn-btn", ICONS.horn, "Horn", CONTROL.LSHOCK, TOUCH_CONFIG.horn);

      this.fire = this.makeHold("touch-fire-btn", ICONS.fist, "Attack or fire", CONTROL.CIRCLE, TOUCH_CONFIG.fire);

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

    makeHold(className, icon, label, control, box) {
      const b = new TouchButton({
        parent: this.root,
        className,
        icon,
        label,
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
      window.addEventListener("resize", () => this.refreshVisibility());
      window.addEventListener("blur", () => this.resetAll());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.resetAll();
      });
    }

    isTouchEnvironment() {
      return navigator.maxTouchPoints > 0 || matchMedia("(pointer:coarse)").matches;
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
