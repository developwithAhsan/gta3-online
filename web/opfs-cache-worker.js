const CACHE_DIR = "_gta3_asset_cache_v1";
const ARCHIVE_FILE = "game.zip";
const META_FILE = "meta.json";
const MAX_RETRIES = 12;

function postProgress(data) {
  self.postMessage({ type: "progress", ...data });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function copyStreamToOPFS(stream, writable, loadedStart, total, phase, resumeFrom = 0) {
  if (!stream) throw new Error("Download response has no readable body.");
  const reader = stream.getReader();
  let loaded = loadedStart;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await writable.write(value);
    loaded += value.byteLength;
    postProgress({ phase, loaded, total, resumed: phase === "resuming", resumeFrom });
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

function retryDelay(attempt) {
  return Math.min(15000, 1500 * Math.pow(1.55, Math.max(0, attempt - 1)));
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchDownload(url, existing) {
  const headers = existing > 0 ? { Range: "bytes=" + existing + "-" } : undefined;
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok && response.status !== 206) {
    const err = new Error("Download failed: HTTP " + response.status);
    err.httpStatus = response.status;
    throw err;
  }
  return response;
}

async function cacheRemoteUrl(url) {
  const oldMeta = await readMeta();
  let total = 0;

  if (oldMeta?.source === "remote" && oldMeta?.url === url && !oldMeta.complete) {
    total = Number(oldMeta.total || 0);
  } else {
    await clearCache();
  }

  if (!total) total = await getRemoteSize(url);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let existing = await getArchiveSize();

    if (total && existing >= total && existing > 0) {
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

    let writable = null;
    try {
      writable = await openArchiveWritable(existing);
      let response = await fetchDownload(url, existing);
      let phase = "downloading";
      let resumeFrom = 0;

      if (existing > 0) {
        if (response.status === 206) {
          phase = "resuming";
          resumeFrom = existing;
          postProgress({
            phase: "resuming",
            loaded: existing,
            total,
            resumed: true,
            resumeFrom,
          });
        } else {
          // Server did not honor Range. Restart safely from zero.
          try { await writable.close(); } catch {}
          await clearCache();
          existing = 0;
          writable = await openArchiveWritable(0);
          response = await fetchDownload(url, 0);
        }
      }

      if (!total) {
        const headerTotal = Number(response.headers.get("content-length") || 0);
        if (response.status === 206) {
          const range = response.headers.get("content-range") || "";
          const match = /\/([0-9]+)$/.exec(range);
          total = match ? Number(match[1]) : headerTotal + existing;
        } else {
          total = headerTotal;
        }
      }

      const loaded = await copyStreamToOPFS(
        response.body,
        writable,
        existing,
        total,
        phase,
        resumeFrom
      );
      await writable.close();
      writable = null;

      const finalSize = await getArchiveSize();
      if (total && finalSize !== total) {
        throw new Error("Downloaded ZIP size mismatch: got " + finalSize + ", expected " + total);
      }

      await writeMeta({
        complete: true,
        source: "remote",
        url,
        size: finalSize || loaded,
        total: total || finalSize || loaded,
        savedAt: new Date().toISOString(),
      });

      self.postMessage({
        type: "done",
        size: finalSize || loaded,
        resumed: resumeFrom > 0,
      });
      return;
    } catch (err) {
      if (writable) {
        try { await writable.close(); } catch {}
      }

      const partialSize = await getArchiveSize();
      await writeMeta({
        complete: false,
        source: "remote",
        url,
        size: partialSize,
        total,
        savedAt: new Date().toISOString(),
      });

      const status = Number(err?.httpStatus || 0);
      const canRetry = attempt < MAX_RETRIES && (!status || retryableStatus(status));
      if (!canRetry) throw err;

      const retryInMs = retryDelay(attempt + 1);
      postProgress({
        phase: "retrying",
        loaded: partialSize,
        total,
        retryInMs,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
      });
      await sleep(retryInMs);
      // Next loop reads the actual partial file size and sends a Range request.
    }
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
    throw new Error("Unknown OPFS worker request: " + msg.type);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err?.stack || err?.message || String(err),
    });
  }
};
