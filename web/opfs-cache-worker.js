const CACHE_DIR = "_gta3_asset_cache_v1";
const ARCHIVE_FILE = "game.zip";
const META_FILE = "meta.json";

function postProgress(data) {
  self.postMessage({ type: "progress", ...data });
}

async function getCacheDir(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CACHE_DIR, { create });
}

async function getArchiveSize() {
  try {
    const dir = await getCacheDir(false);
    const handle = await dir.getFileHandle(ARCHIVE_FILE);
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
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

async function writeMeta(meta) {
  const dir = await getCacheDir(true);
  const handle = await dir.getFileHandle(META_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

async function clearCache() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(CACHE_DIR, { recursive: true });
  } catch {}
}

async function openArchiveWritable(offset = 0) {
  const dir = await getCacheDir(true);
  const handle = await dir.getFileHandle(ARCHIVE_FILE, { create: true });
  if (offset > 0) {
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.seek(offset);
    return writable;
  }
  return handle.createWritable();
}

async function copyStreamToOPFS(stream, writable, loadedStart, total, phase) {
  if (!stream) throw new Error("Download response has no readable body.");
  const reader = stream.getReader();
  let loaded = loadedStart;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await writable.write(value);
    loaded += value.byteLength;
    postProgress({ phase, loaded, total });
  }
  return loaded;
}

async function getRemoteSize(url) {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!response.ok) return 0;
    return Number(response.headers.get("content-length") || 0);
  } catch {
    return 0;
  }
}

async function cacheLocalFile(file) {
  await clearCache();
  const writable = await openArchiveWritable(0);
  try {
    const loaded = await copyStreamToOPFS(file.stream(), writable, 0, file.size || 0, "caching-local");
    await writable.close();
    await writeMeta({
      complete: true,
      source: "local",
      name: file.name || "game.zip",
      size: loaded,
      savedAt: new Date().toISOString(),
    });
    self.postMessage({ type: "done", size: loaded, resumed: false });
  } catch (err) {
    try { await writable.close(); } catch {}
    throw err;
  }
}

async function cacheRemoteUrl(url) {
  const oldMeta = await readMeta();
  let existing = 0;
  let total = 0;
  let canResume = false;

  if (oldMeta?.source === "remote" && oldMeta?.url === url && !oldMeta.complete) {
    existing = await getArchiveSize();
    total = Number(oldMeta.total || 0);
    canResume = existing > 0;
  } else {
    await clearCache();
  }

  if (!total) total = await getRemoteSize(url);

  if (canResume && total && existing >= total) {
    await writeMeta({
      complete: true,
      source: "remote",
      url,
      size: existing,
      total,
      savedAt: new Date().toISOString(),
    });
    self.postMessage({ type: "done", size: existing, resumed: true });
    return;
  }

  await writeMeta({
    complete: false,
    source: "remote",
    url,
    size: existing,
    total,
    savedAt: new Date().toISOString(),
  });

  let writable = await openArchiveWritable(existing);
  let loaded = existing;
  let resumed = false;

  try {
    if (existing > 0) {
      const response = await fetch(url, {
        headers: { Range: `bytes=${existing}-` },
        redirect: "follow",
      });

      if (response.status === 206) {
        resumed = true;
        loaded = await copyStreamToOPFS(response.body, writable, existing, total, "downloading");
      } else {
        try { await writable.close(); } catch {}
        await clearCache();
        existing = 0;
        loaded = 0;
        writable = await openArchiveWritable(0);
      }
    }

    if (loaded === 0) {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      if (!total) total = Number(response.headers.get("content-length") || 0);
      loaded = await copyStreamToOPFS(response.body, writable, 0, total, "downloading");
    }

    await writable.close();

    const finalSize = await getArchiveSize();
    if (total && finalSize !== total) {
      throw new Error(`Downloaded ZIP size mismatch: got ${finalSize}, expected ${total}`);
    }

    await writeMeta({
      complete: true,
      source: "remote",
      url,
      size: finalSize,
      total: total || finalSize,
      savedAt: new Date().toISOString(),
    });

    self.postMessage({ type: "done", size: finalSize, resumed });
  } catch (err) {
    try { await writable.close(); } catch {}
    const partialSize = await getArchiveSize();
    await writeMeta({
      complete: false,
      source: "remote",
      url,
      size: partialSize,
      total,
      savedAt: new Date().toISOString(),
    });
    throw err;
  }
}

self.onmessage = async (event) => {
  try {
    const msg = event.data || {};
    if (msg.type === "cache-file") {
      await cacheLocalFile(msg.file);
      return;
    }
    if (msg.type === "cache-url") {
      await cacheRemoteUrl(msg.url);
      return;
    }
    throw new Error(`Unknown OPFS worker request: ${msg.type}`);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err?.stack || err?.message || String(err),
    });
  }
};
