const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 3001;
const ALLOWED_ORIGIN = "http://localhost:5500";
const KEY_FILE = path.join(__dirname, "..", ".secrets", "demo-account-api-key.txt");

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    if (origin && origin !== ALLOWED_ORIGIN) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
    }

    const pathname = new URL(
        req.url,
        `http://${HOST}:${PORT}`
    ).pathname;

    if (
        req.method !== "GET" ||
        !["/dashboard/usage", "/dashboard/history"].includes(pathname)
    ) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Not found" }));
    }

    try {
        const apiKey = fs.readFileSync(KEY_FILE, "utf8").trim();

        if (!apiKey) {
            throw new Error("API key file is empty");
        }

        const isHistory = pathname === "/dashboard/history";

        const upstreamUrl = isHistory
            ? "http://127.0.0.1:3000/usage/history?page=1&limit=20"
            : "http://127.0.0.1:3000/usage";

        const upstream = await fetch(upstreamUrl, {
            headers: { "x-api-key": apiKey },
            signal: AbortSignal.timeout(5000),
        });

        const data = await upstream.json();

        if (!upstream.ok) {
            res.writeHead(502);
            return res.end(JSON.stringify({ error: "Usage API request failed" }));
        }

        res.writeHead(200, { "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
    } catch {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "Could not load usage data. Check the API and local key file." }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Dashboard proxy listening on http://${HOST}:${PORT}`);
});