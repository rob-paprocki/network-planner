// Worker for the network planner site. Static files come from ./public; this handles /api/*.
// Plans are checked in memory and dropped: nothing is stored or logged.
import { check, carve, info } from "../public/ipplan.js";

const MAX_BODY = 256 * 1024;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}
const fail = (status, error) => json({ ok: false, error }, status);

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new HttpError(413, `Request body is over ${MAX_BODY / 1024} KB.`);
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, `Request body is over ${MAX_BODY / 1024} KB.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The body isn't valid JSON.");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(request, env, path) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (env.API_LIMIT) {
    const key = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.API_LIMIT.limit({ key });
    if (!success) return fail(429, "Too many requests. Try again in a minute.");
  }

  if (path === "/api/check") {
    if (request.method !== "POST") return fail(405, "POST a plan as JSON to /api/check.");
    const plan = await readJson(request);
    const findings = check(plan);
    return json({ ok: !findings.some((f) => f.level === "error"), findings });
  }
  if (path === "/api/carve") {
    if (request.method !== "POST") return fail(405, 'POST {"parent": CIDR, "requests": [{"name", "hosts"}], "avoid": [CIDR]} to /api/carve.');
    const body = await readJson(request);
    if (!body || typeof body.parent !== "string" || !Array.isArray(body.requests))
      return fail(400, 'Send {"parent": "192.0.2.0/24", "requests": [{"name": "users", "hosts": 50}], "avoid": []}.');
    const avoid = Array.isArray(body.avoid) ? body.avoid.filter((a) => typeof a === "string") : [];
    const r = carve(body.parent, body.requests.map((q) => ({ name: String(q?.name ?? ""), hosts: Number(q?.hosts) })), avoid);
    return json(r, r.ok ? 200 : 422);
  }
  if (path === "/api/info") {
    const cidr = new URL(request.url).searchParams.get("cidr");
    if (!cidr) return fail(400, "Add ?cidr=192.0.2.0/26.");
    const r = info(cidr);
    return json(r, r.ok ? 200 : 422);
  }
  return fail(404, "Unknown API path. See /api for the list.");
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path === "/api") {
      return json({
        ok: true,
        endpoints: {
          "POST /api/check": "Body: a plan (schema 1). Returns {ok, findings}.",
          "POST /api/carve": 'Body: {"parent": CIDR, "requests": [{"name", "hosts"}], "avoid": [CIDR]}. Returns sized and placed segments.',
          "GET /api/info?cidr=CIDR": "Mask, usable count, first, last and broadcast address.",
        },
        docs: "https://github.com/rob-paprocki/network-planner",
        privacy: "Plans are checked in memory and not stored or logged.",
      });
    }
    if (path.startsWith("/api/")) {
      try {
        return await api(request, env, path);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.message);
        return fail(500, "Something went wrong checking that request.");
      }
    }
    return env.ASSETS.fetch(request);
  },
};
