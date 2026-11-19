// Serves a local copy of the maketitle-assets repository with CORS, for testing the compile check without downloading TeX Live.
// usage: node scripts/serve-assets.mjs <dir> <port>
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize } from "node:path";
const [dir, port] = [process.argv[2], Number(process.argv[3] || 4183)];
const types = { ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain", ".cnf": "text/plain" };
http.createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = join(dir, p);
  try {
    const st = statSync(f);
    if (!st.isFile()) throw 0;
    const ext = f.slice(f.lastIndexOf("."));
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Length": st.size, "Content-Type": types[ext] || "application/octet-stream" });
    createReadStream(f).pipe(res);
  } catch { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`assets on http://127.0.0.1:${port}/ from ${dir}`));
