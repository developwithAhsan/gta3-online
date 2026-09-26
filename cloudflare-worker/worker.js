/**
 * GTA III asset proxy for the browser OPFS downloader.
 *
 * Google Drive can return a virus-scan / "Download anyway" HTML page for large
 * files. This Worker resolves that confirmation page server-side, then streams
 * the ZIP with CORS + Range headers so GitHub Pages can save it into OPFS.
 */

const FILE_ID = "1CI50_lKEVQ22gjl2BdZwjxeJ4J_tJ_vL";
const BASE_DOWNLOAD_URL =
  `https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "no-store",
};

async function readResponsePrefix(response, maxBytes = 256) {
  const clone = response.clone();
  const reader = clone.body?.getReader();
  if (!reader) return new Uint8Array(0);
  try {
    const { value } = await reader.read();
    if (!value) return new Uint8Array(0);
    return value instanceof Uint8Array
      ? value.subarray(0, maxBytes)
      : new Uint8Array(value).subarray(0, maxBytes);
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

async function isHtmlResponse(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) return true;

  const prefix = await readResponsePrefix(response, 256);
  if (!prefix.length) return false;
  const text = new TextDecoder().decode(prefix).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    text.startsWith("<head") ||
    text.startsWith("<body")
  );
}

async function startsWithZip(response) {
  const prefix = await readResponsePrefix(response, 4);
  return (
    prefix.length >= 4 &&
    prefix[0] === 0x50 &&
    prefix[1] === 0x4b &&
    (
      (prefix[2] === 0x03 && prefix[3] === 0x04) ||
      (prefix[2] === 0x05 && prefix[3] === 0x06) ||
      (prefix[2] === 0x07 && prefix[3] === 0x08)
    )
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readHtmlAttribute(tag, name) {
  const re = new RegExp(name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i");
  const match = tag.match(re);
  return match ? decodeHtml(match[1]) : "";
}

function parseDownloadForm(html) {
  const formMatch = html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i);
  if (!formMatch) return null;

  const action = readHtmlAttribute(formMatch[1], "action");
  if (!action) return null;

  const url = new URL(action, "https://drive.usercontent.google.com/");
  const body = formMatch[2];
  const inputRe = /<input\b[^>]*>/gi;
  let match;
  while ((match = inputRe.exec(body))) {
    const tag = match[0];
    const name = readHtmlAttribute(tag, "name");
    if (!name) continue;
    url.searchParams.set(name, readHtmlAttribute(tag, "value"));
  }

  if (!url.searchParams.has("id")) url.searchParams.set("id", FILE_ID);
  if (!url.searchParams.has("export")) url.searchParams.set("export", "download");
  if (!url.searchParams.has("confirm")) url.searchParams.set("confirm", "t");

  return url.toString();
}

function parseDownloadLink(html) {
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html))) {
    const href = decodeHtml(match[1]);
    if (!/download|confirm=|export=download/i.test(href)) continue;
    try {
      const url = new URL(href, "https://drive.usercontent.google.com/");
      if (!url.searchParams.has("id")) url.searchParams.set("id", FILE_ID);
      if (!url.searchParams.has("export")) url.searchParams.set("export", "download");
      if (!url.searchParams.has("confirm")) url.searchParams.set("confirm", "t");
      return url.toString();
    } catch {}
  }
  return null;
}

function totalFromContentRange(value) {
  const match = /\/([0-9]+)$/.exec(value || "");
  return match ? Number(match[1]) : 0;
}

function proxyHeaders(upstream, { forceLength = null } = {}) {
  const headers = new Headers(CORS);
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") || "application/zip",
  );
  headers.set("Accept-Ranges", "bytes");

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  const contentLength =
    forceLength ?? upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", String(contentLength));

  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return headers;
}

function forwardCookie(response) {
  return response.headers.get("set-cookie") || "";
}

async function rawFetch(url, range = null, cookie = "") {
  const headers = new Headers({
    Accept: "application/octet-stream, application/zip, */*",
    "User-Agent": "Mozilla/5.0",
  });
  if (range) headers.set("Range", range);
  if (cookie) headers.set("Cookie", cookie);

  return fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false },
  });
}

async function fetchDriveFile(range = null) {
  // First try the stable file-ID URL. Do not use temporary authuser/uuid/at
  // parameters copied from one browser session.
  let response = await rawFetch(BASE_DOWNLOAD_URL, range);

  if (!(await isHtmlResponse(response))) {
    if (!range && !(await startsWithZip(response))) {
      throw new Error("Google Drive returned binary data that is not a ZIP archive.");
    }
    return response;
  }

  // Google Drive can label its virus-scan confirmation page as
  // application/octet-stream, so inspect the body rather than trusting MIME type.
  const cookie = forwardCookie(response);
  const html = await response.text();
  const confirmedUrl = parseDownloadForm(html) || parseDownloadLink(html);

  if (!confirmedUrl) {
    const lower = html.toLowerCase();
    if (
      lower.includes("sign in") ||
      lower.includes("request access") ||
      lower.includes("you need access")
    ) {
      throw new Error(
        'Google Drive file is not publicly downloadable. Set sharing to "Anyone with the link".',
      );
    }
    if (lower.includes("quota") || lower.includes("too many users")) {
      throw new Error("Google Drive download quota has been exceeded.");
    }
    throw new Error(
      "Google Drive returned a confirmation page but no usable download URL was found.",
    );
  }

  response = await rawFetch(confirmedUrl, range, cookie);

  if (await isHtmlResponse(response)) {
    const secondHtml = await response.text();
    const lower = secondHtml.toLowerCase();
    if (lower.includes("quota") || lower.includes("too many users")) {
      throw new Error("Google Drive download quota has been exceeded.");
    }
    if (
      lower.includes("sign in") ||
      lower.includes("request access") ||
      lower.includes("you need access")
    ) {
      throw new Error(
        'Google Drive file is not publicly downloadable. Set sharing to "Anyone with the link".',
      );
    }
    throw new Error(
      "Google Drive still returned HTML after the confirmation request.",
    );
  }

  if (!range && !(await startsWithZip(response))) {
    throw new Error("Confirmed Google Drive response is not a ZIP archive.");
  }

  return response;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: CORS,
      });
    }

    try {
      if (request.method === "HEAD") {
        // Probe one byte because Drive's normal HEAD can omit the useful size.
        const probe = await fetchDriveFile("bytes=0-0");

        if (!probe.ok && probe.status !== 206) {
          return new Response(
            `Upstream probe failed: HTTP ${probe.status}`,
            { status: 502, headers: CORS },
          );
        }

        const total =
          totalFromContentRange(probe.headers.get("content-range")) ||
          Number(probe.headers.get("content-length") || 0);

        return new Response(null, {
          status: 200,
          headers: proxyHeaders(probe, {
            forceLength: total || null,
          }),
        });
      }

      const range = request.headers.get("Range");
      const upstream = await fetchDriveFile(range);

      if (!upstream.ok && upstream.status !== 206) {
        return new Response(
          `Upstream download failed: HTTP ${upstream.status}`,
          { status: 502, headers: CORS },
        );
      }

      return new Response(upstream.body, {
        status: upstream.status === 206 ? 206 : 200,
        headers: proxyHeaders(upstream),
      });
    } catch (err) {
      return new Response(
        `Proxy fetch failed: ${err?.message || err}`,
        { status: 502, headers: CORS },
      );
    }
  },
};
