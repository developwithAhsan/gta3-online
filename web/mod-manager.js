(() => {
  "use strict";

  const STORE_DIR = "_gta3_mod_manager_v1";
  const META_FILE = "mods.json";

  const overlay = document.getElementById("mod-manager-overlay");
  const openBtn = document.getElementById("mod-manager-btn");
  const closeBtn = document.getElementById("mod-manager-close");
  const uploadBtn = document.getElementById("mod-upload-btn");
  const uploadInput = document.getElementById("mod-upload-input");
  const refreshBtn = document.getElementById("mod-refresh-btn");
  const gameFilesBtn = document.getElementById("game-files-btn");
  const modsTabBtn = document.getElementById("mods-tab-btn");
  const filesTabBtn = document.getElementById("files-tab-btn");
  const modsPanel = document.getElementById("mods-panel");
  const filesPanel = document.getElementById("files-panel");
  const list = document.getElementById("mod-list");
  const statusEl = document.getElementById("mod-manager-status");
  const searchInput = document.getElementById("game-file-search");
  const fileCount = document.getElementById("game-file-count");
  const fileSource = document.getElementById("game-file-source");
  const fileList = document.getElementById("game-file-list");

  if (!overlay || !openBtn || !closeBtn || !list || !statusEl) return;

  let visibleEntries = [];
  let currentFileSource = "game";

  function supported() {
    return !!(navigator.storage && navigator.storage.getDirectory);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes >= 102400 ? 0 : 1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + " MB";
  }

  async function getDir(create) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(STORE_DIR, { create: create !== false });
  }

  async function loadMeta() {
    if (!supported()) return { mods: [] };
    try {
      const dir = await getDir(false);
      const handle = await dir.getFileHandle(META_FILE);
      const data = JSON.parse(await (await handle.getFile()).text());
      return data && Array.isArray(data.mods) ? data : { mods: [] };
    } catch {
      return { mods: [] };
    }
  }

  async function saveMeta(meta) {
    const dir = await getDir(true);
    const handle = await dir.getFileHandle(META_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ mods: meta.mods }, null, 2));
    await writable.close();
  }

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "mod-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  async function storeFile(name, blob) {
    const dir = await getDir(true);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function getStoredFile(modInfo) {
    const dir = await getDir(false);
    const handle = await dir.getFileHandle(modInfo.storageName);
    return handle.getFile();
  }

  async function removeStoredFile(name) {
    try {
      const dir = await getDir(false);
      await dir.removeEntry(name);
    } catch (err) {
      if (err && err.name !== "NotFoundError") throw err;
    }
  }

  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }

  async function listZipEntries(file) {
    if (!file || file.size < 22) throw new Error("ZIP file is empty or incomplete.");
    const tailSize = Math.min(file.size, 65557);
    const tailOffset = file.size - tailSize;
    const tailBuffer = await file.slice(tailOffset).arrayBuffer();
    const tail = new DataView(tailBuffer);
    let eocd = -1;

    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP directory was not found. The file may be incomplete.");

    const totalEntries = u16(tail, eocd + 10);
    const centralSize = u32(tail, eocd + 12);
    const centralOffset = u32(tail, eocd + 16);
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 file browsing is not supported yet.");
    }

    const centralBuffer = await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer();
    const view = new DataView(centralBuffer);
    const bytes = new Uint8Array(centralBuffer);
    const decoder = new TextDecoder("utf-8");
    const entries = [];
    let pos = 0;

    while (pos + 46 <= view.byteLength && entries.length < totalEntries) {
      if (u32(view, pos) !== 0x02014b50) break;
      const flags = u16(view, pos + 8);
      const method = u16(view, pos + 10);
      const compressedSize = u32(view, pos + 20);
      const uncompressedSize = u32(view, pos + 24);
      const nameLen = u16(view, pos + 28);
      const extraLen = u16(view, pos + 30);
      const commentLen = u16(view, pos + 32);
      const start = pos + 46;
      const end = start + nameLen;
      if (end > view.byteLength) break;
      let name = decoder.decode(bytes.subarray(start, end)).replace(/\\/g, "/");
      entries.push({
        name: name,
        isDir: name.endsWith("/"),
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        method: method,
        encrypted: !!(flags & 1)
      });
      pos = end + extraLen + commentLen;
    }
    return entries;
  }

  function fileType(name) {
    if (name.endsWith("/")) return "folder";
    const base = name.split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "file";
  }

  async function installMod(file) {
    if (!supported()) throw new Error("This browser does not support OPFS mod storage.");
    if (!file || !/\.zip$/i.test(file.name)) throw new Error("Choose a .zip mod package.");
    if (file.size <= 0) throw new Error("The selected ZIP is empty.");

    statusEl.textContent = "Inspecting mod ZIP…";
    const entries = await listZipEntries(file);
    const files = entries.filter(function(entry) { return !entry.isDir; });
    if (!files.length) throw new Error("The ZIP contains no files.");

    const blocked = files.filter(function(entry) {
      return /\.(exe|dll|asi|bat|cmd|com)$/i.test(entry.name);
    });
    const recognized = files.filter(function(entry) {
      return /(^|\/)(models|data|anim|text)\//i.test(entry.name);
    });

    const id = makeId();
    const storageName = id + ".zip";
    statusEl.textContent = "Saving " + file.name + " to browser storage…";
    await storeFile(storageName, file);

    const meta = await loadMeta();
    meta.mods.push({
      id: id,
      name: file.name,
      storageName: storageName,
      size: file.size,
      enabled: true,
      addedAt: new Date().toISOString(),
      entries: entries.length,
      recognized: recognized.length,
      blocked: blocked.length
    });
    await saveMeta(meta);
    statusEl.textContent = "Installed " + file.name + ". It will apply on the next launch.";
    await renderMods();
  }

  async function setEnabled(id, enabled) {
    const meta = await loadMeta();
    const modInfo = meta.mods.find(function(item) { return item.id === id; });
    if (!modInfo) return;
    modInfo.enabled = !!enabled;
    await saveMeta(meta);
  }

  async function removeMod(id) {
    const meta = await loadMeta();
    const index = meta.mods.findIndex(function(item) { return item.id === id; });
    if (index < 0) return;
    const removed = meta.mods.splice(index, 1)[0];
    await removeStoredFile(removed.storageName);
    await saveMeta(meta);
  }

  async function downloadMod(id) {
    const meta = await loadMeta();
    const modInfo = meta.mods.find(function(item) { return item.id === id; });
    if (!modInfo) throw new Error("Mod not found.");
    const file = await getStoredFile(modInfo);
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = modInfo.name || "gta3-mod.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function showTab(name) {
    const files = name === "files";
    modsPanel.classList.toggle("hidden", files);
    filesPanel.classList.toggle("hidden", !files);
    modsTabBtn.classList.toggle("active", !files);
    filesTabBtn.classList.toggle("active", files);
  }

  function renderEntries(entries, query) {
    const q = String(query || "").trim().toLowerCase();
    const filtered = q ? entries.filter(function(entry) {
      return entry.name.toLowerCase().includes(q);
    }) : entries;
    const shown = filtered.slice(0, 2500);
    fileCount.textContent = filtered.length.toLocaleString() + " files";

    if (!shown.length) {
      fileList.innerHTML = '<div class="mod-empty">No matching files.</div>';
      return;
    }

    fileList.innerHTML = shown.map(function(entry) {
      return '<div class="game-file-row">' +
        '<span class="game-file-name" title="' + escapeHtml(entry.name) + '">' + escapeHtml(entry.name) + '</span>' +
        '<span class="game-file-size">' + (entry.isDir ? "—" : formatBytes(entry.uncompressedSize)) + '</span>' +
        '<span class="game-file-type">' + escapeHtml(fileType(entry.name)) + '</span>' +
        '</div>';
    }).join("");

    if (filtered.length > shown.length) {
      fileList.insertAdjacentHTML("beforeend", '<div class="mod-empty">Showing the first 2,500 results. Use search to narrow the list.</div>');
    }
  }

  async function browseGameFiles() {
    showTab("files");
    currentFileSource = "game";
    visibleEntries = [];
    searchInput.value = "";
    fileSource.textContent = "Cached GTA III ZIP • OPFS";
    fileCount.textContent = "Loading…";
    fileList.innerHTML = '<div class="mod-empty">Reading cached ZIP directory…</div>';

    const cacheStatus = await window.OPFSAssetCache.getStatus();
    if (!cacheStatus.ready) {
      fileCount.textContent = "0 files";
      fileList.innerHTML = '<div class="mod-empty">The GTA III ZIP is not cached yet. Run PLAY GAME once, then return here.</div>';
      return;
    }

    const archive = await window.OPFSAssetCache.getArchiveFile();
    visibleEntries = await listZipEntries(archive);
    renderEntries(visibleEntries, "");
  }

  async function browseModFiles(id) {
    const meta = await loadMeta();
    const modInfo = meta.mods.find(function(item) { return item.id === id; });
    if (!modInfo) throw new Error("Mod not found.");
    const file = await getStoredFile(modInfo);
    visibleEntries = await listZipEntries(file);
    currentFileSource = "mod";
    searchInput.value = "";
    fileSource.textContent = "Mod ZIP • " + modInfo.name;
    showTab("files");
    renderEntries(visibleEntries, "");
  }

  async function renderMods() {
    if (!supported()) {
      statusEl.textContent = "OPFS is not supported in this browser.";
      list.innerHTML = '<div class="mod-empty">Persistent Mod Manager requires OPFS.</div>';
      return;
    }

    const meta = await loadMeta();
    statusEl.textContent = meta.mods.length
      ? meta.mods.length + " mod package(s) installed. Enabled mods apply on the next launch."
      : "No mods installed. Upload a GTA III PC/re3-compatible ZIP.";

    if (!meta.mods.length) {
      list.innerHTML = '<div class="mod-empty">No mod ZIPs installed.</div>';
      return;
    }

    list.innerHTML = meta.mods.map(function(modInfo) {
      const stateClass = modInfo.enabled ? " on" : "";
      const stateText = modInfo.enabled ? "ENABLED" : "DISABLED";
      const blockedBadge = modInfo.blocked
        ? '<span class="mod-badge">' + modInfo.blocked + ' blocked native file(s)</span>'
        : "";
      return '<div class="mod-row">' +
        '<div class="mod-main">' +
          '<strong title="' + escapeHtml(modInfo.name) + '">' + escapeHtml(modInfo.name) + '</strong>' +
          '<small>' + formatBytes(modInfo.size) + ' • ' + (modInfo.entries || 0) + ' ZIP entries</small>' +
          '<div class="mod-badges">' +
            '<span class="mod-badge' + stateClass + '">' + stateText + '</span>' +
            '<span class="mod-badge">' + (modInfo.recognized || 0) + ' recognized game file(s)</span>' +
            blockedBadge +
          '</div>' +
        '</div>' +
        '<div class="mod-actions">' +
          '<button class="mod-action-btn" data-action="toggle" data-id="' + modInfo.id + '">' + (modInfo.enabled ? "DISABLE" : "ENABLE") + '</button>' +
          '<button class="mod-action-btn" data-action="inspect" data-id="' + modInfo.id + '">VIEW FILES</button>' +
          '<button class="mod-action-btn" data-action="download" data-id="' + modInfo.id + '">DOWNLOAD ZIP</button>' +
          '<button class="mod-action-btn danger" data-action="delete" data-id="' + modInfo.id + '">REMOVE</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  async function applyEnabledMods(FS, mountPoint, options) {
    options = options || {};
    if (!supported()) return { applied: 0, files: 0 };

    const meta = await loadMeta();
    const enabled = meta.mods.filter(function(item) { return item.enabled; });
    let applied = 0;
    let files = 0;

    for (let i = 0; i < enabled.length; i++) {
      const modInfo = enabled[i];
      const file = await getStoredFile(modInfo);
      if (options.onProgress) {
        options.onProgress({ index: i, total: enabled.length, name: modInfo.name, currentFile: "" });
      }
      const count = await window.AssetVFS.mountFromZipFile(FS, mountPoint, file, {
        onProgress: function(progress) {
          if (options.onProgress) {
            options.onProgress({
              index: i,
              total: enabled.length,
              name: modInfo.name,
              currentFile: progress.currentFile || ""
            });
          }
        }
      });
      applied++;
      files += count;
      if (options.log) options.log("[mods] " + modInfo.name + ": " + count + " runtime file(s) applied", "info");
    }
    return { applied: applied, files: files };
  }

  async function openManager() {
    document.exitPointerLock?.();
    overlay.classList.remove("hidden");
    showTab("mods");
    await renderMods();
  }

  openBtn.addEventListener("click", function() {
    openManager().catch(function(err) { statusEl.textContent = String(err && err.message || err); });
  });
  closeBtn.addEventListener("click", function() { overlay.classList.add("hidden"); });
  overlay.addEventListener("click", function(event) {
    if (event.target === overlay) overlay.classList.add("hidden");
  });

  uploadBtn.addEventListener("click", function() {
    uploadInput.value = "";
    uploadInput.click();
  });
  uploadInput.addEventListener("change", function() {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;
    installMod(file).catch(function(err) { statusEl.textContent = String(err && err.message || err); });
  });
  refreshBtn.addEventListener("click", function() {
    renderMods().catch(function(err) { statusEl.textContent = String(err && err.message || err); });
  });
  gameFilesBtn.addEventListener("click", function() {
    browseGameFiles().catch(function(err) {
      fileList.innerHTML = '<div class="mod-empty">' + escapeHtml(String(err && err.message || err)) + '</div>';
    });
  });
  modsTabBtn.addEventListener("click", function() { showTab("mods"); });
  filesTabBtn.addEventListener("click", function() {
    if (currentFileSource !== "game" || !visibleEntries.length) {
      browseGameFiles().catch(function(err) {
        fileList.innerHTML = '<div class="mod-empty">' + escapeHtml(String(err && err.message || err)) + '</div>';
      });
    } else {
      showTab("files");
    }
  });
  searchInput.addEventListener("input", function() {
    renderEntries(visibleEntries, searchInput.value);
  });

  list.addEventListener("click", async function(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      const meta = await loadMeta();
      const modInfo = meta.mods.find(function(item) { return item.id === id; });
      if (!modInfo) return;

      if (action === "toggle") {
        await setEnabled(id, !modInfo.enabled);
        await renderMods();
      } else if (action === "inspect") {
        await browseModFiles(id);
      } else if (action === "download") {
        await downloadMod(id);
      } else if (action === "delete") {
        if (!confirm('Remove mod "' + modInfo.name + '" from browser storage?')) return;
        await removeMod(id);
        await renderMods();
      }
    } catch (err) {
      statusEl.textContent = String(err && err.message || err);
    }
  });

  window.GTA3ModManager = {
    supported: supported,
    loadMeta: loadMeta,
    listZipEntries: listZipEntries,
    applyEnabledMods: applyEnabledMods,
    browseGameFiles: browseGameFiles
  };
})();
