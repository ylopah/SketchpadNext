import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
]);

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const relative = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const absolute = path.resolve(root, `.${relative}`);
    if (!absolute.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(absolute);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(absolute).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = `http://127.0.0.1:${port}`;
  console.log(`SketchpadNext: ${address}`);

  // The Windows launcher asks the server to open the page only after the
  // listening socket is ready. This avoids a race where the browser opens
  // before the local server can respond.
  if (process.env.SKETCHPAD_OPEN_BROWSER === "1" && process.platform === "win32") {
    const opener = spawn("explorer.exe", [address], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    opener.on("error", (error) => {
      console.error(`[SketchpadNext] 无法自动打开浏览器，请手动访问 ${address}`, error.message);
    });
    opener.unref();
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`[SketchpadNext] 端口 ${port} 已被占用。请关闭旧的服务窗口后重试。`);
  } else {
    console.error("[SketchpadNext] 启动失败：", error);
  }
  process.exitCode = 1;
});
