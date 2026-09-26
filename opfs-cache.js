(() => {
  "use strict";

  const CACHE_DIR = "_gta3_asset_cache_v1";
  const ARCHIVE_FILE = "game.zip";
  const META_FILE = "meta.json";
  const WORKER_URL = "opfs-cache-worker.js";

  function supported() {
    return !!(navigator.storage && navigator.storage.getDirectory && window.Worker);
  }

  async function requestPersistence() {
    try {
      if (navigator.storage.persist) return await navigator.storage.persist();
    } catch {}
    return false;
  }

  async function getCacheDir(create = false) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(CACHE_DIR, { create });
  }

  async function readMeta() {
    try {
      const dir = await getCacheDir(false);
      const handle = await dir.getFileHandle(META_FILE);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  async function getStatus() {
    if (!supported()) return { supported: false, ready: false, size: 0, meta: null };
    try {
      const dir = await getCacheDir(false);
      const meta = await readMeta();
      if (!meta?.complete) return { supported: true, ready: false, size: 0, meta };
      const handle = await dir.getFileHandle(ARCHIVE_FILE);
      const file = await handle.getFile();
      const ready = file.size > 0 && (!meta.size || file.size === meta.size);
      return { supported: true, ready, size: file.size, meta };
    } catch {
      return { supported: true, ready: false, size: 0, meta: null };
    }
  }

  async function getArchiveFile() {
    const dir = await getCacheDir(false);
    const handle = await dir.getFileHandle(ARCHIVE_FILE);
    return handle.getFile();
  }

  async function clear() {
    if (!supported()) return;
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(CACHE_DIR, { recursive: true });
    } catch {}
  }

  function runWorker(message, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL);
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        fn(value);
      };

      worker.onerror = (event) => {
        finish(reject, new Error(event.message || "OPFS cache worker crashed"));
      };

      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === "progress") {
          onProgress?.(msg);
          return;
        }
        if (msg.type === "done") {
          finish(resolve, msg);
          return;
        }
        if (msg.type === "error") {
          finish(reject, new Error(msg.message || "OPFS cache operation failed"));
        }
      };

      worker.postMessage(message);
    });
  }

  async function cacheLocalFile(file, options = {}) {
    if (!supported()) throw new Error("OPFS is not supported by this browser.");
    if (!file) throw new Error("No ZIP file selected.");
    return runWorker({ type: "cache-file", file }, options);
  }

  async function cacheRemoteUrl(url, options = {}) {
    if (!supported()) throw new Error("OPFS is not supported by this browser.");
    if (!url) throw new Error("No asset URL configured.");
    return runWorker({ type: "cache-url", url }, options);
  }

  window.OPFSAssetCache = {
    supported,
    requestPersistence,
    getStatus,
    getArchiveFile,
    cacheLocalFile,
    cacheRemoteUrl,
    clear,
  };
})();
