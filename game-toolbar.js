(() => {
  "use strict";

  // The list below mirrors the GTA 3 cheat list supplied for the in-game menu.
  const CHEATS = Object.freeze([
    ["All Weapons", "GUNSGUNSGUNS"],
    ["Money ($250,000)", "IFIWEREARICHMAN"],
    ["Full Armour", "TORTOISE"],
    ["Full Health", "GESUNDHEIT"],
    ["Raise Wanted Level", "MOREPOLICEPLEASE"],
    ["Lower Wanted Level", "NOPOLICEPLEASE"],
    ["Increased Gore", "NASTYLIMBSCHEAT"],
    ["Pedestrians Fight Each Other with Weapons", "WEAPONSFORALL"],
    ["Pedestrians Fight Each Other", "ITSALLGOINGMAAAD"],
    ["Pedestrians Hate You", "NOBODYLIKESME"],
    ["Spawn Rhino Tank", "GIVEUSATANK"],
    ["Change Costumes", "ILIKEDRESSINGUP"],
    ["Clear Weather", "SKINCANCERFORME"],
    ["Foggy Weather", "PEASOUP"],
    ["Cloudy Weather", "ILIKESCOTLAND"],
    ["Rainy Weather", "ILOVESCOTLAND"],
    ["Slow Motion", "BOOOOORING"],
    ["Fast Motion", "TIMEFLIESWHENYOU"],
    ["Speed Up Time", "MADWEATHER"],
    ["Improve Driving Skill", "CORNERSLIKEMAD"],
    ["Turn Vehicle Invisible", "ANICESETOFWHEELS"],
    ["Destroy All Cars", "BANGBANGBANG"],
    ["Flying Vehicle", "CHITTYCHITTYBB"],
  ]);

  const cheatBtn = document.getElementById("game-cheats-btn");
  const moreBtn = document.getElementById("game-more-games-btn");
  const sensitivityBtn = document.getElementById("game-sensitivity-btn");

  const cheatPanel = document.getElementById("game-cheats-panel");
  const morePanel = document.getElementById("game-more-games-panel");
  const sensitivityPanel = document.getElementById("game-sensitivity-panel");

  const cheatList = document.getElementById("game-cheats-list");
  const cheatStatus = document.getElementById("game-cheat-status");
  const cheatClose = document.getElementById("game-cheats-close");
  const sensitivityClose = document.getElementById("game-sensitivity-close");
  const sensitivityRange = document.getElementById("game-sensitivity-range");
  const sensitivityOutput = document.getElementById("game-sensitivity-output");

  if (!cheatBtn || !moreBtn || !sensitivityBtn || !cheatPanel || !morePanel || !sensitivityPanel) {
    return;
  }

  const panels = [cheatPanel, morePanel, sensitivityPanel];

  function closePanels(except = null) {
    for (const panel of panels) {
      if (panel !== except) panel.classList.add("hidden");
    }
    cheatBtn.classList.toggle("active", !cheatPanel.classList.contains("hidden"));
    moreBtn.classList.toggle("active", !morePanel.classList.contains("hidden"));
    sensitivityBtn.classList.toggle("active", !sensitivityPanel.classList.contains("hidden"));
  }

  function togglePanel(panel) {
    const willOpen = panel.classList.contains("hidden");
    closePanels(panel);
    panel.classList.toggle("hidden", !willOpen);
    cheatBtn.classList.toggle("active", panel === cheatPanel && willOpen);
    moreBtn.classList.toggle("active", panel === morePanel && willOpen);
    sensitivityBtn.classList.toggle("active", panel === sensitivityPanel && willOpen);
  }

  function clampSensitivity(value) {
    const n = Number.parseInt(value, 10);
    return Math.max(50, Math.min(200, Number.isFinite(n) ? n : 100));
  }

  function currentSensitivity() {
    try {
      return clampSensitivity(window.GTA3_TOUCH_SENSITIVITY || localStorage.getItem("gta3.touchSensitivity") || 100);
    } catch {
      return 100;
    }
  }

  function paintSensitivity(value) {
    const next = clampSensitivity(value);
    sensitivityRange.value = String(next);
    sensitivityOutput.value = `${next}%`;
    sensitivityOutput.textContent = `${next}%`;
  }

  function setSensitivity(value) {
    const next = clampSensitivity(value);
    paintSensitivity(next);
    window.GTA3_TOUCH_SENSITIVITY = next;

    const homeRange = document.getElementById("touch-sensitivity-input");
    const homeOutput = document.getElementById("touch-sensitivity-value");
    if (homeRange) homeRange.value = String(next);
    if (homeOutput) {
      homeOutput.value = `${next}%`;
      homeOutput.textContent = `${next}%`;
    }

    try {
      localStorage.setItem("gta3.touchSensitivity", String(next));
    } catch {}

    window.dispatchEvent(new CustomEvent("gta3-touch-sensitivity-change", {
      detail: { value: next },
    }));
  }

  let applyNativeCheat = null;

  function getCheatBridge() {
    const mod = window.re3Module;
    if (!mod || typeof mod.cwrap !== "function") return null;
    if (!applyNativeCheat) {
      try {
        applyNativeCheat = mod.cwrap("re3_BrowserApplyCheat", "number", ["string"]);
      } catch (err) {
        console.warn("[cheats] native cheat bridge unavailable", err);
        return null;
      }
    }
    return applyNativeCheat;
  }

  function setCheatStatus(message, state = "") {
    cheatStatus.textContent = message;
    cheatStatus.dataset.state = state;
  }

  function applyCheat(label, code) {
    const bridge = getCheatBridge();
    if (!bridge) {
      setCheatStatus("Game engine is still loading. Start GTA III first.", "error");
      return;
    }

    try {
      const accepted = bridge(code);
      if (accepted > 0) {
        setCheatStatus(`Applied: ${label} — ${code}`, "success");
      } else {
        setCheatStatus(`Could not apply ${code}.`, "error");
      }
    } catch (err) {
      console.error("[cheats] apply failed", err);
      setCheatStatus(`Could not apply ${code}.`, "error");
    }
  }

  for (const [label, code] of CHEATS) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "game-cheat-item";
    row.innerHTML = `
      <span class="game-cheat-name">${label}</span>
      <code class="game-cheat-code">${code}</code>
      <span class="game-cheat-apply">APPLY</span>
    `;
    row.addEventListener("click", () => applyCheat(label, code));
    cheatList.appendChild(row);
  }

  cheatBtn.addEventListener("click", () => togglePanel(cheatPanel));
  moreBtn.addEventListener("click", () => togglePanel(morePanel));
  sensitivityBtn.addEventListener("click", () => {
    paintSensitivity(currentSensitivity());
    togglePanel(sensitivityPanel);
  });

  cheatClose?.addEventListener("click", () => {
    cheatPanel.classList.add("hidden");
    closePanels();
  });
  sensitivityClose?.addEventListener("click", () => {
    sensitivityPanel.classList.add("hidden");
    closePanels();
  });

  sensitivityRange.addEventListener("input", () => setSensitivity(sensitivityRange.value));
  sensitivityRange.addEventListener("change", () => setSensitivity(sensitivityRange.value));

  window.addEventListener("gta3-touch-sensitivity-change", event => {
    paintSensitivity(event.detail?.value ?? currentSensitivity());
  });

  document.addEventListener("pointerdown", event => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (
      cheatPanel.contains(target) || morePanel.contains(target) || sensitivityPanel.contains(target) ||
      cheatBtn.contains(target) || moreBtn.contains(target) || sensitivityBtn.contains(target)
    ) return;
    closePanels();
  }, { passive: true });

  window.addEventListener("blur", () => closePanels());
  paintSensitivity(currentSensitivity());

  window.GTA3CheatMenu = Object.freeze({
    cheats: CHEATS,
    apply(code) {
      const match = CHEATS.find(item => item[1] === String(code).toUpperCase());
      if (match) applyCheat(match[0], match[1]);
    },
  });
})();
