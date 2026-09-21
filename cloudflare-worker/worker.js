/**
 * GTA III asset proxy for the browser OPFS downloader.
 *
 * Why this exists:
 * Google Drive direct-download URLs can work when opened in the address bar but
 * still reject cross-origin fetch() from GitHub Pages. A Worker fetches the
 * authorized archive server-side and adds the CORS/range headers the browser
 * downloader needs.
 */

const UPSTREAM_URL = "https://drive.usercontent.google.com/download?id=1CI50_lKEVQ22gjl2BdZwjxeJ4J_tJ_vL&export=download&authuser=8&confirm=t&uuid=a361c096-5cd6-4110-b885-f7179149c3bb&at=AMrWOn0-CjE2VosXilWxxD6mBvg8%3A1789910493665";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "no-store",
};

function proxyHeaders(upstream, { forceLength = null } = {}) {
  const headers = new Headers(CORS);
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/zip");
  headers.set("Accept-Ranges", "bytes");

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  const contentLength = forceLength ?? upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", String(contentLength));

  return headers;
}

function totalFromContentRange(value) {
  const match = /\/([0-9]+)$/.exec(value || "");
  return match ? Number(match[1]) : 0;
}

async function fetchUpstream(range = null) {
  const headers = {
    "Accept": "application/octet-stream, application/zip, */*",
    "User-Agent": "Mozilla/5.0",
  };
  if (range) headers.Range = range;

  return fetch(UPSTREAM_URL, {
    method: "GET",
    headers,
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    try {
      if (request.method === "HEAD") {
        // Google Drive HEAD responses are not always useful. Request one byte so
        // Content-Range can reveal the real total archive size.
        const probe = await fetchUpstream("bytes=0-0");
        if (!probe.ok && probe.status !== 206) {
          return new Response(`Upstream probe failed: HTTP ${probe.status}`, {
            status: 502,
            headers: CORS,
          });
        }

        const ct = probe.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          return new Response("Upstream returned HTML instead of the ZIP archive.", {
            status: 502,
            headers: CORS,
          });
        }

        const total =
          totalFromContentRange(probe.headers.get("content-range")) ||
          Number(probe.headers.get("content-length") || 0);

        return new Response(null, {
          status: 200,
          headers: proxyHeaders(probe, { forceLength: total || null }),
        });
      }

      const range = request.headers.get("Range");
      const upstream = await fetchUpstream(range);

      if (!upstream.ok && upstream.status !== 206) {
        return new Response(`Upstream download failed: HTTP ${upstream.status}`, {
          status: 502,
          headers: CORS,
        });
      }

      const ct = upstream.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        return new Response("Upstream returned HTML instead of the ZIP archive.", {
          status: 502,
          headers: CORS,
        });
      }

      return new Response(upstream.body, {
        status: upstream.status === 206 ? 206 : 200,
        headers: proxyHeaders(upstream),
      });
    } catch (err) {
      return new Response(`Proxy fetch failed: ${err?.message || err}`, {
        status: 502,
        headers: CORS,
      });
    }
  },
};
