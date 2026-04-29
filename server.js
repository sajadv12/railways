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
    const isHttps = targetUrl.protocol === "https:";
    const port = targetUrl.port
      ? parseInt(targetUrl.port)
      : isHttps ? 443 : 80;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;
      headers[k] = value;
    }
    headers["host"] = targetUrl.hostname;

    const path = targetUrl.pathname + (targetUrl.search || "");

    const options = {
      hostname: targetUrl.hostname,
      port,
      path,
      method: req.method,
      headers,
      // Disable connection pooling for long-lived xhttp streams
      agent: false,
    };

    const proto = isHttps ? https : http;

    const proxy = proto.request(options, (upstream) => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (key.toLowerCase() === "transfer-encoding") continue;
        responseHeaders[key] = value;
      }
      responseHeaders["cache-control"] = "no-store";

      res.writeHead(upstream.statusCode, responseHeaders);

      // Stream response back, handle early client disconnect
      upstream.pipe(res);
      res.on("close", () => upstream.destroy());
    });

    proxy.on("error", (err) => {
      console.error("Proxy error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Bad Gateway");
      }
    });

    // Stream request body to upstream, handle early upstream disconnect
    req.pipe(proxy);
    proxy.on("close", () => req.destroy());

  } catch (err) {
    console.error("Handler error:", err.message);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});

// Support long-lived streaming connections (xhttp)
server.timeout = 0;
server.keepAliveTimeout = 0;

server.listen(PORT, () => {
  console.log(`Relay running on port ${PORT} → ${TARGET}`);
});
