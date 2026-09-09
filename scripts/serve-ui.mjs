import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../ui/dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

if (!existsSync(join(root, "index.html"))) throw new Error("UI is not built. Run npm run ui:build first.");
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  let file = join(root, relative || "index.html");
  if (!file.startsWith(root)) { response.writeHead(403).end("Forbidden"); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", extname(file) === ".html" ? "no-store" : "public, max-age=60");
  createReadStream(file).pipe(response);
});
server.listen(port, "127.0.0.1", () => console.log(`ProofKey Work Treasury UI: http://127.0.0.1:${port}`));
