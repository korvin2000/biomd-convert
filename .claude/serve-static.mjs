/**
 * Dependency-free static file server for L3 visual adjudication.
 *
 * The fixtures must be reached over HTTP, not `file://`, so that relative asset
 * references and the CSS cascade behave as they did on the original site. This
 * is deliberately not `npx http-server`: an npx download is a network dependency
 * that fails in a sandboxed session, and a diagnostic instrument that cannot
 * start offline is not an instrument.
 *
 *   node .claude/serve-static.mjs <root-dir> <port>
 *
 * HTML is served without a charset parameter, so the document's own <meta>
 * declaration governs decoding — the same precedence the converter's measurer
 * sees.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8123);

const TYPES = {
  ".htm": "text/html",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
};

if (!existsSync(root)) {
  console.warn(`WARN root does not exist yet: ${root} (every request will 404)`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  const target = resolve(root, rel);

  // Containment check: a normalized path that escapes the root is refused.
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403).end("403 outside root");
    console.log(`403 ${url.pathname}`);
    return;
  }

  let stat = null;
  try {
    stat = statSync(target);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(`404 ${rel}`);
    console.log(`404 ${url.pathname}`);
    return;
  }

  if (stat.isDirectory()) {
    for (const candidate of ["index.html", "index.htm"]) {
      if (existsSync(join(target, candidate))) {
        res.writeHead(302, { location: `${url.pathname.replace(/\/?$/, "/")}${candidate}` }).end();
        return;
      }
    }
    const entries = await readdir(target, { withFileTypes: true });
    const items = entries
      .map((e) => {
        const name = e.isDirectory() ? `${e.name}/` : e.name;
        return `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? "/" : ""}">${name}</a></li>`;
      })
      .join("\n");
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(`<!doctype html><meta charset="utf-8"><title>${rel || "/"}</title><ul>${items}</ul>`);
    console.log(`200 ${url.pathname} (index)`);
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
    // Never cache: these files change between conversions and a stale render is
    // a silently wrong measurement.
    "cache-control": "no-store",
  });
  createReadStream(target).pipe(res);
  console.log(`200 ${url.pathname}`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://localhost:${port}`);
});
