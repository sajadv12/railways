const http = require("http");
const https = require("https");
const { URL } = require("url");

const TARGET = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
]);

if (!TARGET) {
  console.error("ERROR: TARGET_DOMAIN environment variable is not set.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  try {
    const targetUrl = new URL(TARGET + req.url);

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;
      headers[k] = value;
    }
    headers["host"] = targetUrl.hostname;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
    };

    const proto = targetUrl.protocol === "https:" ? https : http;

    const proxy = proto.request(options, (upstream) => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (key.toLowerCase() === "transfer-encoding") continue;
        responseHeaders[key] = value;
      }
      responseHeaders["cache-control"] = "no-store";

      res.writeHead(upstream.statusCode, responseHeaders);
      upstream.pipe(res);
    });

    proxy.on("error", (err) => {
      console.error("Proxy error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Bad Gateway");
      }
    });

    req.pipe(proxy);

  } catch (err) {
    console.error("Handler error:", err.message);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Relay running on port ${PORT} → ${TARGET}`);
});
