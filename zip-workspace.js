(() => {
  "use strict";

  const ROOT_NAME = "_gta3_zip_workspace_v1";
  const FILES_DIR = "files";
  const META_FILE = "workspace.json";
  const SOURCE_ZIP = "source.zip";
  const EXPORT_ZIP = "edited.zip";
  const MAX_RETRIES = 8;
  const TEXT_EXTENSIONS = new Set([
    "txt", "cfg", "dat", "ide", "ipl", "zon", "ini", "json", "xml", "md", "log", "csv"
  ]);

  const tabBtn = document.getElementById("workspace-tab-btn");
  const panel = document.getElementById("workspace-panel");
  const uploadBtn = document.getElementById("workspace-upload-btn");
  const gameDownloadBtn = document.getElementById("workspace-game-download-btn");
  const urlInput = document.getElementById("workspace-url-input");
  const urlDownloadBtn = document.getElementById("workspace-url-download-btn");
  const resumeBtn = document.getElementById("workspace-resume-btn");
  const uploadInput = document.getElementById("workspace-upload-input");

  const progressBox = document.getElementById("workspace-progress");
  const progressTitle = document.getElementById("workspace-progress-title");
  const progressPercent = document.getElementById("workspace-progress-percent");
  const progressFill = document.getElementById("workspace-progress-fill");
  const progressBytes = document.getElementById("workspace-progress-bytes");
  const progressEta = document.getElementById("workspace-progress-eta");

  const upBtn = document.getElementById("workspace-up-btn");
  const newFolderBtn = document.getElementById("workspace-new-folder-btn");
  const addFilesBtn = document.getElementById("workspace-add-files-btn");
  const addFilesInput = document.getElementById("workspace-add-files-input");
  const exportBtn = document.getElementById("workspace-export-btn");
  const applyBtn = document.getElementById("workspace-apply-mod-btn");
  const clearBtn = document.getElementById("workspace-clear-btn");

  const nameEl = document.getElementById("workspace-name");
  const breadcrumb = document.getElementById("workspace-breadcrumb");
  const statusEl = document.getElementById("workspace-status");
  const searchInput = document.getElementById("workspace-search");
  const countEl = document.getElementById("workspace-count");
  const listEl = document.getElementById("workspace-file-list");

  const editor = document.getElementById("workspace-editor");
  const editorName = document.getElementById("workspace-editor-name");
  const editorText = document.getElementById("workspace-editor-text");
  const editorClose = document.getElementById("workspace-editor-close");
  const editorSave = document.getElementById("workspace-editor-save");
  const editorCancel = document.getElementById("workspace-editor-cancel");

  if (!panel || !uploadBtn || !listEl) return;

  let currentPath = [];
  let currentEntries = [];
  let editingPath = null;
  let busy = false;

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

  function cleanName(value) {
    const name = String(value || "").trim();
    if (!name || name === "." || name === "..") return null;
    if (/[\\/\0]/.test(name)) return null;
    return name;
  }

  function cleanZipPath(raw) {
    const parts = String(raw || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(function(part) { return part && part !== "."; });
    if (!parts.length || parts.some(function(part) { return part === ".."; })) return null;
    return parts;
  }

  function extOf(name) {
    const base = String(name || "").split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  }

  function isTextFile(name) {
    return TEXT_EXTENSIONS.has(extOf(name));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(bytes >= 100 * 1024 ? 0 : 1) + " KB";
    }
    if (bytes < 1024 * 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + " MB";
    }
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "Calculating…";
    const total = Math.max(0, Math.ceil(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      return hours + "h " + (mins % 60) + "m";
    }
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function showProgress(title, fraction, bytesText, etaText) {
    progressBox.classList.remove("hidden");
    progressTitle.textContent = title || "WORKING…";
    const pct = fraction == null ? null : Math.max(0, Math.min(1, fraction));
    progressFill.style.width = pct == null ? "16%" : Math.round(pct * 100) + "%";
    progressFill.classList.toggle("indeterminate", pct == null);
    progressPercent.textContent = pct == null ? "…" : Math.round(pct * 100) + "%";
    progressBytes.textContent = bytesText || "";
    progressEta.textContent = etaText || "";
  }

  function hideProgress() {
    progressBox.classList.add("hidden");
    progressFill.classList.remove("indeterminate");
  }

  function createRateTracker() {
    let lastAt = performance.now();
    let lastBytes = 0;
    let speed = 0;
    return function(loaded, total) {
      const now = performance.now();
      const dt = (now - lastAt) / 1000;
      if (dt >= 0.25) {
        const instant = Math.max(0, loaded - lastBytes) / dt;
        speed = speed ? speed * 0.72 + instant * 0.28 : instant;
        lastBytes = loaded;
        lastAt = now;
      }
      return {
        speed: speed,
        eta: speed > 0 && total > loaded ? (total - loaded) / speed : null
      };
    };
  }

  async function rootDir(create) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(ROOT_NAME, { create: create !== false });
  }

  async function filesRoot(create) {
    const root = await rootDir(create);
    return root.getDirectoryHandle(FILES_DIR, { create: create !== false });
  }

  async function readMeta() {
    if (!supported()) return null;
    try {
      const root = await rootDir(false);
      const handle = await root.getFileHandle(META_FILE);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  async function writeMeta(meta) {
    const root = await rootDir(true);
    const handle = await root.getFileHandle(META_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(meta, null, 2));
    await writable.close();
  }

  async function sourceFile() {
    const root = await rootDir(false);
    const handle = await root.getFileHandle(SOURCE_ZIP);
    return handle.getFile();
  }

  async function sourceSize() {
    try {
      return (await sourceFile()).size;
    } catch {
      return 0;
    }
  }

  async function clearAll() {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(ROOT_NAME, { recursive: true });
    } catch {}
    currentPath = [];
    currentEntries = [];
    editingPath = null;
  }

  async function resetExtractedFiles() {
    const root = await rootDir(true);
    try {
      await root.removeEntry(FILES_DIR, { recursive: true });
    } catch {}
    await root.getDirectoryHandle(FILES_DIR, { create: true });
    currentPath = [];
  }

  async function dirAt(pathParts, create) {
    let dir = await filesRoot(create);
    for (const part of pathParts) {
      dir = await dir.getDirectoryHandle(part, { create: create !== false });
    }
    return dir;
  }

  async function parentAndName(pathParts) {
    if (!pathParts.length) throw new Error("Root folder has no parent.");
    return {
      parent: await dirAt(pathParts.slice(0, -1), false),
      name: pathParts[pathParts.length - 1]
    };
  }

  async function ensureZipPath(pathParts) {
    let dir = await filesRoot(true);
    for (const part of pathParts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return dir;
  }

  async function writeBlobToSource(blob, meta) {
    const root = await rootDir(true);
    const handle = await root.getFileHandle(SOURCE_ZIP, { create: true });
    const writable = await handle.createWritable();
    const reader = blob.stream().getReader();
    const total = blob.size || 0;
    let loaded = 0;
    const rate = createRateTracker();

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      await writable.write(result.value);
      loaded += result.value.byteLength;
      const metric = rate(loaded, total);
      showProgress(
        "COPYING ZIP…",
        total ? loaded / total : null,
        formatBytes(loaded) + (total ? " / " + formatBytes(total) : ""),
        metric.eta == null ? "Calculating…" : "About " + formatEta(metric.eta) + " remaining"
      );
    }

    await writable.close();
    meta.size = loaded;
    meta.total = total || loaded;
    meta.complete = true;
    meta.downloadComplete = true;
    meta.updatedAt = new Date().toISOString();
    await writeMeta(meta);
  }

  function u16(view, offset) {
    return view.getUint16(offset, true);
  }

  function u32(view, offset) {
    return view.getUint32(offset, true);
  }

  async function parseZipDirectory(file) {
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

    if (eocd < 0) throw new Error("ZIP directory was not found. The archive may be incomplete.");

    const totalEntries = u16(tail, eocd + 10);
    const centralSize = u32(tail, eocd + 12);
    const centralOffset = u32(tail, eocd + 16);

    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 workspaces are not supported yet.");
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
      const localOffset = u32(view, pos + 42);
      const nameStart = pos + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > view.byteLength) break;

      const rawName = decoder.decode(bytes.subarray(nameStart, nameEnd));
      const path = cleanZipPath(rawName);
      if (path) {
        entries.push({
          rawName: rawName,
          path: path,
          isDir: rawName.replace(/\\/g, "/").endsWith("/"),
          flags: flags,
          method: method,
          compressedSize: compressedSize,
          uncompressedSize: uncompressedSize,
          localOffset: localOffset
        });
      }

      pos = nameEnd + extraLen + commentLen;
    }

    return entries;
  }

  async function assertStorageForExtraction(entries) {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const estimate = await navigator.storage.estimate();
    const available = Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0));
    const expanded = entries.reduce(function(sum, entry) {
      return sum + (entry.isDir ? 0 : Number(entry.uncompressedSize || 0));
    }, 0);
    const required = Math.ceil(expanded * 1.08 + 32 * 1024 * 1024);

    if (available && required > available) {
      throw new Error(
        "Not enough browser storage to open this ZIP for editing. Need about " +
        formatBytes(required) + ", available about " + formatBytes(available) + "."
      );
    }
  }

  async function copyStoredSliceToFile(zipFile, start, length, writable, onBytes) {
    const reader = zipFile.slice(start, start + length).stream().getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      await writable.write(result.value);
      onBytes(result.value.byteLength);
    }
  }

  async function inflateSliceToFile(zipFile, start, length, writable, onBytes) {
    if (!window.fflate || !window.fflate.Inflate) {
      throw new Error("The ZIP decompression library did not load.");
    }

    let writeChain = Promise.resolve();
    let inflateError = null;
    const inflater = new window.fflate.Inflate(function(chunk) {
      if (!chunk || !chunk.length) return;
      onBytes(chunk.length);
      writeChain = writeChain.then(function() {
        return writable.write(chunk);
      }).catch(function(err) {
        inflateError = err;
        throw err;
      });
    });

    const reader = zipFile.slice(start, start + length).stream().getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        inflater.push(new Uint8Array(0), true);
        break;
      }
      inflater.push(result.value, false);
      await writeChain;
      if (inflateError) throw inflateError;
    }
    await writeChain;
  }

  async function extractWorkspaceZip(zipFile, meta) {
    setStatus("Reading ZIP directory…");
    showProgress("READING ZIP…", null, formatBytes(zipFile.size), "Preparing file list…");

    const entries = await parseZipDirectory(zipFile);
    if (!entries.length) throw new Error("The ZIP does not contain readable entries.");
    if (entries.some(function(entry) { return !!(entry.flags & 1); })) {
      throw new Error("Encrypted/password-protected ZIP files are not supported.");
    }

    await assertStorageForExtraction(entries);
    await resetExtractedFiles();

    const totalExpanded = entries.reduce(function(sum, entry) {
      return sum + (entry.isDir ? 0 : Number(entry.uncompressedSize || 0));
    }, 0);

    let expandedDone = 0;
    let filesDone = 0;
    const rate = createRateTracker();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const parts = entry.path;
      const displayPath = parts.join("/");

      if (entry.isDir) {
        await ensureZipPath(parts);
        continue;
      }

      if (entry.method !== 0 && entry.method !== 8) {
        throw new Error("Unsupported ZIP compression method " + entry.method + " for " + displayPath + ".");
      }

      const localHeader = new DataView(await zipFile.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      if (u32(localHeader, 0) !== 0x04034b50) {
        throw new Error("Invalid ZIP local header for " + displayPath + ".");
      }

      const localNameLen = u16(localHeader, 26);
      const localExtraLen = u16(localHeader, 28);
      const dataStart = entry.localOffset + 30 + localNameLen + localExtraLen;

      const parent = await ensureZipPath(parts.slice(0, -1));
      const handle = await parent.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await handle.createWritable();
      let entryExpanded = 0;

      const onBytes = function(count) {
        entryExpanded += count;
        expandedDone += count;
        const metric = rate(expandedDone, totalExpanded);
        showProgress(
          "EXTRACTING ZIP…",
          totalExpanded ? expandedDone / totalExpanded : (i + 1) / entries.length,
          formatBytes(expandedDone) + (totalExpanded ? " / " + formatBytes(totalExpanded) : ""),
          metric.eta == null ? displayPath : "About " + formatEta(metric.eta) + " • " + displayPath
        );
      };

      try {
        if (entry.method === 0) {
          await copyStoredSliceToFile(zipFile, dataStart, entry.compressedSize, writable, onBytes);
        } else {
          await inflateSliceToFile(zipFile, dataStart, entry.compressedSize, writable, onBytes);
        }
        await writable.close();
      } catch (err) {
        try { await writable.abort(); } catch {}
        throw err;
      }

      filesDone++;
      if (entry.uncompressedSize && entryExpanded !== entry.uncompressedSize) {
        // Some ZIP writers can vary around metadata; keep extraction but surface it in status.
        setStatus("Extracted " + displayPath + " with a size mismatch warning.");
      }

      if (filesDone % 8 === 0) await new Promise(function(resolve) { setTimeout(resolve, 0); });
    }

    meta.extracted = true;
    meta.entryCount = entries.length;
    meta.fileCount = filesDone;
    meta.expandedSize = expandedDone;
    meta.updatedAt = new Date().toISOString();
    meta.lastPath = [];
    await writeMeta(meta);

    currentPath = [];
    showProgress("READY", 1, filesDone + " files", "Workspace extracted");
    setTimeout(hideProgress, 700);
    setStatus("ZIP is open and editable. Changes are saved in browser storage.");
    await renderCurrentFolder();
  }

  async function importZipBlob(blob, name, sourceType, url) {
    if (!supported()) throw new Error("OPFS is required for the ZIP workspace.");
    if (!blob || !blob.size) throw new Error("The selected ZIP is empty.");

    busy = true;
    try {
      await clearAll();
      const meta = {
        version: 1,
        name: name || "workspace.zip",
        sourceType: sourceType || "upload",
        url: url || "",
        complete: false,
        downloadComplete: false,
        extracted: false,
        size: 0,
        total: blob.size,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastPath: []
      };
      await writeMeta(meta);
      await writeBlobToSource(blob, meta);
      const zip = await sourceFile();
      await extractWorkspaceZip(zip, meta);
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function remoteTotal(url) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (!response.ok) return 0;
      return Number(response.headers.get("content-length") || 0);
    } catch {
      return 0;
    }
  }

  function retryDelay(attempt) {
    return Math.min(12000, 1200 * Math.pow(1.6, Math.max(0, attempt - 1)));
  }

  async function downloadUrlToWorkspace(url, nameHint, forceRestart) {
    if (!supported()) throw new Error("OPFS is required for ZIP downloads.");
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http/https ZIP URLs are supported.");
    }

    busy = true;
    try {
      let meta = await readMeta();
      const same = meta && meta.url === parsed.href && meta.sourceType === "url" && !meta.downloadComplete;
      if (!same || forceRestart) {
        await clearAll();
        meta = {
          version: 1,
          name: nameHint || "downloaded.zip",
          sourceType: "url",
          url: parsed.href,
          complete: false,
          downloadComplete: false,
          extracted: false,
          size: 0,
          total: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastPath: []
        };
        await writeMeta(meta);
      }

      let total = Number(meta.total || 0);
      if (!total) total = await remoteTotal(parsed.href);

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let existing = await sourceSize();
        const root = await rootDir(true);
        const handle = await root.getFileHandle(SOURCE_ZIP, { create: true });
        let writable = await handle.createWritable({ keepExistingData: existing > 0 });
        if (existing > 0) await writable.seek(existing);

        try {
          const headers = existing > 0 ? { Range: "bytes=" + existing + "-" } : undefined;
          let response = await fetch(parsed.href, { headers: headers, redirect: "follow" });

          if (!response.ok && response.status !== 206) {
            const err = new Error("ZIP download failed: HTTP " + response.status);
            err.httpStatus = response.status;
            throw err;
          }

          let resumed = existing > 0 && response.status === 206;
          if (existing > 0 && !resumed) {
            try { await writable.close(); } catch {}
            const root2 = await rootDir(true);
            try { await root2.removeEntry(SOURCE_ZIP); } catch {}
            existing = 0;
            writable = await (await root2.getFileHandle(SOURCE_ZIP, { create: true })).createWritable();
            response = await fetch(parsed.href, { redirect: "follow" });
            if (!response.ok) throw new Error("ZIP download failed: HTTP " + response.status);
          }

          if (!total) {
            if (response.status === 206) {
              const range = response.headers.get("content-range") || "";
              const match = /\/([0-9]+)$/.exec(range);
              total = match ? Number(match[1]) : existing + Number(response.headers.get("content-length") || 0);
            } else {
              total = Number(response.headers.get("content-length") || 0);
            }
          }

          if (!response.body) throw new Error("The download response has no readable stream.");

          const reader = response.body.getReader();
          let loaded = existing;
          const rate = createRateTracker();

          while (true) {
            const result = await reader.read();
            if (result.done) break;
            await writable.write(result.value);
            loaded += result.value.byteLength;

            const metric = rate(loaded, total);
            showProgress(
              resumed ? "RESUMING ZIP…" : "DOWNLOADING ZIP…",
              total ? loaded / total : null,
              formatBytes(loaded) + (total ? " / " + formatBytes(total) : ""),
              metric.eta == null ? "Calculating…" : "About " + formatEta(metric.eta) + " remaining"
            );

            meta.size = loaded;
            meta.total = total;
            meta.updatedAt = new Date().toISOString();
          }

          await writable.close();

          const finalSize = await sourceSize();
          if (total && finalSize !== total) {
            throw new Error("ZIP download is incomplete (" + formatBytes(finalSize) + " of " + formatBytes(total) + ").");
          }

          meta.size = finalSize;
          meta.total = total || finalSize;
          meta.complete = true;
          meta.downloadComplete = true;
          meta.updatedAt = new Date().toISOString();
          await writeMeta(meta);

          const zip = await sourceFile();
          await extractWorkspaceZip(zip, meta);
          return;
        } catch (err) {
          try { await writable.close(); } catch {}
          const partial = await sourceSize();
          meta.size = partial;
          meta.total = total;
          meta.complete = false;
          meta.downloadComplete = false;
          meta.updatedAt = new Date().toISOString();
          await writeMeta(meta);

          if (attempt >= MAX_RETRIES) throw err;
          const delay = retryDelay(attempt + 1);
          showProgress(
            "CONNECTION LOST — AUTO RESUME",
            total ? partial / total : null,
            formatBytes(partial) + (total ? " / " + formatBytes(total) : ""),
            "Retrying in " + Math.ceil(delay / 1000) + "s"
          );
          await new Promise(function(resolve) { setTimeout(resolve, delay); });
        }
      }
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function downloadConfiguredGameZip() {
    const cache = await window.OPFSAssetCache.getStatus();
    if (cache.ready) {
      setStatus("Using the GTA III ZIP already cached by PLAY GAME…");
      const file = await window.OPFSAssetCache.getArchiveFile();
      await importZipBlob(file, "gta3-game.zip", "cached-game", "");
      return;
    }

    const cfg = window.GTA3_ASSET_CONFIG || {};
    const url = cfg.proxyUrl || cfg.archiveUrl;
    if (!url) throw new Error("No authorized GTA III ZIP URL is configured.");
    await downloadUrlToWorkspace(url, "gta3-game.zip", false);
  }

  async function listFolder(pathParts) {
    const dir = await dirAt(pathParts, false);
    const items = [];

    for await (const pair of dir.entries()) {
      const name = pair[0];
      const handle = pair[1];
      if (handle.kind === "directory") {
        items.push({ name: name, kind: "directory", size: 0 });
      } else {
        const file = await handle.getFile();
        items.push({ name: name, kind: "file", size: file.size });
      }
    }

    items.sort(function(a, b) {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return items;
  }

  async function persistLastPath() {
    const meta = await readMeta();
    if (!meta) return;
    meta.lastPath = currentPath.slice();
    meta.updatedAt = new Date().toISOString();
    await writeMeta(meta);
  }

  function renderBreadcrumb() {
    const buttons = [];
    buttons.push('<button class="workspace-crumb" data-depth="0" type="button">/</button>');
    currentPath.forEach(function(part, index) {
      buttons.push('<span>/</span><button class="workspace-crumb" data-depth="' + (index + 1) + '" type="button">' + escapeHtml(part) + '</button>');
    });
    breadcrumb.innerHTML = buttons.join("");
  }

  function rowActions(item) {
    if (item.kind === "directory") {
      return (
        '<button data-action="open" type="button">OPEN</button>' +
        '<button data-action="rename" type="button">RENAME</button>' +
        '<button class="danger" data-action="delete" type="button">DELETE</button>'
      );
    }

    const edit = isTextFile(item.name)
      ? '<button data-action="edit" type="button">EDIT TEXT</button>'
      : "";
    return (
      edit +
      '<button data-action="replace" type="button">REPLACE</button>' +
      '<button data-action="download" type="button">DOWNLOAD</button>' +
      '<button data-action="rename" type="button">RENAME</button>' +
      '<button class="danger" data-action="delete" type="button">DELETE</button>'
    );
  }

  function renderRows(items) {
    const query = String(searchInput.value || "").trim().toLowerCase();
    const filtered = query
      ? items.filter(function(item) { return item.name.toLowerCase().includes(query); })
      : items;

    countEl.textContent = filtered.length + (filtered.length === 1 ? " item" : " items");

    if (!filtered.length) {
      listEl.innerHTML = '<div class="mod-empty">This folder is empty.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function(item) {
      const icon = item.kind === "directory" ? "📁" : "📄";
      return (
        '<div class="workspace-row" data-name="' + escapeHtml(item.name) + '" data-kind="' + item.kind + '">' +
          '<button class="workspace-entry" data-action="' + (item.kind === "directory" ? "open" : "download") + '" type="button">' +
            '<span class="workspace-entry-icon">' + icon + '</span>' +
            '<span class="workspace-entry-name">' + escapeHtml(item.name) + '</span>' +
          '</button>' +
          '<span class="workspace-entry-size">' + (item.kind === "directory" ? "folder" : formatBytes(item.size)) + '</span>' +
          '<div class="workspace-entry-actions">' + rowActions(item) + '</div>' +
        '</div>'
      );
    }).join("");
  }

  async function renderCurrentFolder() {
    const meta = await readMeta();
    if (!meta || !meta.extracted) {
      currentEntries = [];
      nameEl.textContent = meta && meta.name ? meta.name : "No ZIP loaded";
      setStatus(meta && !meta.downloadComplete ? "Partial ZIP download is available to resume." : "Upload or download a ZIP to begin.");
      resumeBtn.classList.toggle("hidden", !(meta && meta.url && !meta.downloadComplete));
      listEl.innerHTML = '<div class="mod-empty">No editable ZIP workspace is open.</div>';
      countEl.textContent = "0 items";
      breadcrumb.textContent = "/";
      return;
    }

    nameEl.textContent = meta.name || "workspace.zip";
    resumeBtn.classList.add("hidden");

    try {
      currentEntries = await listFolder(currentPath);
    } catch {
      currentPath = [];
      currentEntries = await listFolder(currentPath);
    }

    renderBreadcrumb();
    renderRows(currentEntries);
    setStatus("Editable workspace • " + (meta.fileCount || 0) + " extracted files • changes persist after refresh.");
    await persistLastPath();
  }

  async function refresh() {
    if (!supported()) {
      setStatus("This browser does not support OPFS ZIP workspaces.");
      return;
    }

    const meta = await readMeta();
    if (meta && Array.isArray(meta.lastPath) && !busy) currentPath = meta.lastPath.slice();
    await renderCurrentFolder();
  }

  async function markModified() {
    const meta = await readMeta();
    if (!meta) return;
    meta.modified = true;
    meta.updatedAt = new Date().toISOString();
    await writeMeta(meta);
  }

  async function addFiles(files) {
    if (!files || !files.length) return;
    const dir = await dirAt(currentPath, true);

    for (const file of Array.from(files)) {
      const safe = cleanName(file.name);
      if (!safe) continue;
      let exists = false;
      try {
        await dir.getFileHandle(safe);
        exists = true;
      } catch {}
      if (exists && !confirm('Replace existing file "' + safe + '"?')) continue;

      const handle = await dir.getFileHandle(safe, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
    }

    await markModified();
    await renderCurrentFolder();
  }

  async function replaceFile(name) {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    document.body.appendChild(input);

    await new Promise(function(resolve) {
      input.addEventListener("change", async function() {
        try {
          const file = input.files && input.files[0];
          if (!file) return;
          const dir = await dirAt(currentPath, false);
          const handle = await dir.getFileHandle(name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(file);
          await writable.close();
          await markModified();
          await renderCurrentFolder();
        } finally {
          input.remove();
          resolve();
        }
      }, { once: true });
      input.click();
    });
  }

  async function downloadFile(name) {
    const dir = await dirAt(currentPath, false);
    const file = await (await dir.getFileHandle(name)).getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  async function copyEntry(sourceParent, sourceName, destParent, destName) {
    let fileHandle = null;
    try {
      fileHandle = await sourceParent.getFileHandle(sourceName);
    } catch {}

    if (fileHandle) {
      const sourceFileObj = await fileHandle.getFile();
      const target = await destParent.getFileHandle(destName, { create: true });
      const writable = await target.createWritable();
      await writable.write(sourceFileObj);
      await writable.close();
      return;
    }

    const sourceDir = await sourceParent.getDirectoryHandle(sourceName);
    const targetDir = await destParent.getDirectoryHandle(destName, { create: true });
    for await (const pair of sourceDir.entries()) {
      await copyEntry(sourceDir, pair[0], targetDir, pair[0]);
    }
  }

  async function renameEntry(name) {
    const next = cleanName(prompt("Rename to:", name));
    if (!next || next === name) return;
    const dir = await dirAt(currentPath, false);

    let conflict = false;
    try { await dir.getFileHandle(next); conflict = true; } catch {}
    try { await dir.getDirectoryHandle(next); conflict = true; } catch {}
    if (conflict) throw new Error('An item named "' + next + '" already exists.');

    await copyEntry(dir, name, dir, next);
    await dir.removeEntry(name, { recursive: true });
    await markModified();
    await renderCurrentFolder();
  }

  async function deleteEntry(name, kind) {
    if (!confirm('Delete ' + kind + ' "' + name + '" from the editable ZIP workspace?')) return;
    const dir = await dirAt(currentPath, false);
    await dir.removeEntry(name, { recursive: kind === "directory" });
    await markModified();
    await renderCurrentFolder();
  }

  async function openEditor(name) {
    const dir = await dirAt(currentPath, false);
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("Text editor limit is 2 MB. Use REPLACE for larger files.");
    }

    editingPath = currentPath.concat([name]);
    editorName.textContent = "Editing " + editingPath.join("/");
    editorText.value = await file.text();
    editor.classList.remove("hidden");
    editorText.focus();
  }

  function closeEditor() {
    editor.classList.add("hidden");
    editingPath = null;
    editorText.value = "";
  }

  async function saveEditor() {
    if (!editingPath) return;
    const info = await parentAndName(editingPath);
    const handle = await info.parent.getFileHandle(info.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(editorText.value);
    await writable.close();
    await markModified();
    closeEditor();
    await renderCurrentFolder();
  }

  async function workspaceStats(dir, prefix, out) {
    for await (const pair of dir.entries()) {
      const name = pair[0];
      const handle = pair[1];
      const rel = prefix ? prefix + "/" + name : name;
      if (handle.kind === "directory") {
        out.dirs.push(rel + "/");
        await workspaceStats(handle, rel, out);
      } else {
        const file = await handle.getFile();
        out.files.push({ path: rel, file: file });
        out.total += file.size;
      }
    }
  }

  async function buildEditedZip() {
    if (!window.fflate || !window.fflate.Zip || !window.fflate.ZipPassThrough) {
      throw new Error("ZIP export library is unavailable.");
    }

    const meta = await readMeta();
    if (!meta || !meta.extracted) throw new Error("Open a ZIP workspace first.");

    const filesDir = await filesRoot(false);
    const stats = { files: [], dirs: [], total: 0 };
    await workspaceStats(filesDir, "", stats);

    const root = await rootDir(true);
    const exportHandle = await root.getFileHandle(EXPORT_ZIP, { create: true });
    const writable = await exportHandle.createWritable();
    let outputChain = Promise.resolve();
    let zipError = null;
    let doneResolve;
    let doneReject;
    const donePromise = new Promise(function(resolve, reject) {
      doneResolve = resolve;
      doneReject = reject;
    });

    const zip = new window.fflate.Zip(function(err, chunk, final) {
      if (err) {
        zipError = err;
        doneReject(err);
        return;
      }
      outputChain = outputChain.then(function() {
        return writable.write(chunk);
      });
      if (final) {
        outputChain.then(function() {
          return writable.close();
        }).then(doneResolve).catch(doneReject);
      }
    });

    for (const dirName of stats.dirs) {
      const entry = new window.fflate.ZipPassThrough(dirName);
      zip.add(entry);
      entry.push(new Uint8Array(0), true);
      await outputChain;
    }

    let packed = 0;
    const rate = createRateTracker();

    for (const item of stats.files) {
      if (zipError) throw zipError;
      const entry = new window.fflate.ZipPassThrough(item.path);
      zip.add(entry);
      const reader = item.file.stream().getReader();

      while (true) {
        const result = await reader.read();
        if (result.done) {
          entry.push(new Uint8Array(0), true);
          break;
        }
        entry.push(result.value, false);
        packed += result.value.byteLength;
        const metric = rate(packed, stats.total);
        showProgress(
          "BUILDING EDITED ZIP…",
          stats.total ? packed / stats.total : null,
          formatBytes(packed) + (stats.total ? " / " + formatBytes(stats.total) : ""),
          metric.eta == null ? item.path : "About " + formatEta(metric.eta) + " • " + item.path
        );
        await outputChain;
      }
      await outputChain;
    }

    zip.end();
    await donePromise;

    const exported = await exportHandle.getFile();
    showProgress("ZIP READY", 1, formatBytes(exported.size), "Ready to download");
    setTimeout(hideProgress, 700);
    return exported;
  }

  function suggestedEditedName(meta) {
    const original = meta && meta.name ? meta.name : "gta3-workspace.zip";
    return original.replace(/\.zip$/i, "") + "-edited.zip";
  }

  async function downloadEditedZip() {
    busy = true;
    try {
      const meta = await readMeta();
      const file = await buildEditedZip();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedEditedName(meta);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      setStatus("Edited ZIP downloaded.");
    } finally {
      busy = false;
    }
  }

  async function applyAsMod() {
    busy = true;
    try {
      if (!window.GTA3ModManager || !window.GTA3ModManager.installMod) {
        throw new Error("Mod Manager is not ready.");
      }
      const meta = await readMeta();
      const zipFile = await buildEditedZip();
      const filename = suggestedEditedName(meta).replace(/-edited\.zip$/i, "-workspace-mod.zip");
      const asFile = new File([zipFile], filename, { type: "application/zip" });
      await window.GTA3ModManager.installMod(asFile);
      await window.GTA3ModManager.renderMods();
      setStatus("Workspace exported and installed as an enabled mod.");
    } finally {
      busy = false;
    }
  }

  uploadBtn.addEventListener("click", function() {
    if (busy) return;
    uploadInput.value = "";
    uploadInput.click();
  });

  uploadInput.addEventListener("change", function() {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;
    importZipBlob(file, file.name, "upload", "").catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  gameDownloadBtn.addEventListener("click", function() {
    if (busy) return;
    downloadConfiguredGameZip().catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  urlDownloadBtn.addEventListener("click", function() {
    if (busy) return;
    const url = String(urlInput.value || "").trim();
    if (!url) {
      setStatus("Paste a direct ZIP URL first.");
      return;
    }
    let name = "downloaded.zip";
    try {
      const parsed = new URL(url, location.href);
      name = decodeURIComponent(parsed.pathname.split("/").pop() || "downloaded.zip");
      if (!/\.zip$/i.test(name)) name = "downloaded.zip";
    } catch {}
    downloadUrlToWorkspace(url, name, true).catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  resumeBtn.addEventListener("click", async function() {
    if (busy) return;
    const meta = await readMeta();
    if (!meta || !meta.url) return;
    downloadUrlToWorkspace(meta.url, meta.name || "downloaded.zip", false).catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  upBtn.addEventListener("click", async function() {
    if (!currentPath.length || busy) return;
    currentPath.pop();
    await renderCurrentFolder();
  });

  newFolderBtn.addEventListener("click", async function() {
    if (busy) return;
    const name = cleanName(prompt("New folder name:"));
    if (!name) return;
    const dir = await dirAt(currentPath, true);
    await dir.getDirectoryHandle(name, { create: true });
    await markModified();
    await renderCurrentFolder();
  });

  addFilesBtn.addEventListener("click", function() {
    if (busy) return;
    addFilesInput.value = "";
    addFilesInput.click();
  });

  addFilesInput.addEventListener("change", function() {
    addFiles(addFilesInput.files).catch(function(err) {
      setStatus(String(err && err.message || err));
    });
  });

  exportBtn.addEventListener("click", function() {
    if (busy) return;
    downloadEditedZip().catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  applyBtn.addEventListener("click", function() {
    if (busy) return;
    applyAsMod().catch(function(err) {
      setStatus(String(err && err.message || err));
      hideProgress();
    });
  });

  clearBtn.addEventListener("click", async function() {
    if (busy) return;
    if (!confirm("Clear the entire editable ZIP workspace from browser storage?")) return;
    await clearAll();
    hideProgress();
    await refresh();
  });

  searchInput.addEventListener("input", function() {
    renderRows(currentEntries);
  });

  breadcrumb.addEventListener("click", async function(event) {
    const button = event.target.closest("button[data-depth]");
    if (!button) return;
    const depth = Number(button.dataset.depth || 0);
    currentPath = currentPath.slice(0, Math.max(0, depth));
    await renderCurrentFolder();
  });

  listEl.addEventListener("click", async function(event) {
    const row = event.target.closest(".workspace-row");
    const button = event.target.closest("button[data-action]");
    if (!row || !button || busy) return;

    const name = row.dataset.name;
    const kind = row.dataset.kind;
    const action = button.dataset.action;

    try {
      if (action === "open" && kind === "directory") {
        currentPath.push(name);
        await renderCurrentFolder();
      } else if (action === "download" && kind === "file") {
        await downloadFile(name);
      } else if (action === "edit" && kind === "file") {
        await openEditor(name);
      } else if (action === "replace" && kind === "file") {
        await replaceFile(name);
      } else if (action === "rename") {
        await renameEntry(name);
      } else if (action === "delete") {
        await deleteEntry(name, kind);
      }
    } catch (err) {
      setStatus(String(err && err.message || err));
    }
  });

  editorClose.addEventListener("click", closeEditor);
  editorCancel.addEventListener("click", closeEditor);
  editorSave.addEventListener("click", function() {
    saveEditor().catch(function(err) {
      setStatus(String(err && err.message || err));
    });
  });

  tabBtn?.addEventListener("click", function() {
    refresh().catch(function(err) {
      setStatus(String(err && err.message || err));
    });
  });

  window.GTA3ZipWorkspace = {
    refresh: refresh,
    downloadConfiguredGameZip: downloadConfiguredGameZip,
    downloadUrlToWorkspace: downloadUrlToWorkspace,
    importZipBlob: importZipBlob,
    buildEditedZip: buildEditedZip
  };
})();