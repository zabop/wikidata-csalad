// Local preview server: serves this folder as static files, exactly as GitHub Pages will.
// Usage: npm run dev
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 582;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ged": "text/plain; charset=utf-8",
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const server = http.createServer((req, res) => {
  // macOS only lets non-root processes use ports below 1024 when listening on all
  // interfaces, so we listen broadly but answer requests from this machine only.
  if (!LOOPBACK.has(req.socket.remoteAddress)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden: this viewer only serves requests from this computer.");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(ROOT, path.normalize(rel));
  const hidden = path.relative(ROOT, file).split(path.sep).some((part) => part.startsWith("."));
  if (!file.startsWith(ROOT + path.sep) || hidden || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

server.on("error", (err) => {
  console.error(`Could not start on port ${PORT}: ${err.message}`);
  console.error("Try another port, e.g.: PORT=5820 npm run dev");
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`GEDCOM viewer running at http://localhost:${PORT}`);
});
