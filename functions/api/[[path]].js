// The dashboard's storage API, served by Cloudflare Pages Functions and backed by one KV namespace (binding DB).
//
//   GET  /api/health                 ok when this request may use the API
//   GET  /api/doc/board/pins         one JSON document (null when missing)   PUT replaces it
//   GET  /api/col/ideas              every item in a collection, newest first
//   POST /api/col/ideas              add an item, returns {id}
//   PUT  /api/col/ideas/:id          replace an item               DELETE removes it
//
// Cloudflare Access sits in front of the whole site. As a second lock, every request must carry the email Access
// verified, and it must match ALLOWED_EMAIL. Without Access in front, that header is missing and the API refuses.

const DOCS = new Set(["board/pins", "board/hidden"]);
const COLLECTIONS = new Set(["ideas"]);
const MAX_BODY = 64 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequest({ request, env, params }) {
  const allowed = (env.ALLOWED_EMAIL || "").trim().toLowerCase();
  const email = (request.headers.get("cf-access-authenticated-user-email") || "").trim().toLowerCase();
  if (!allowed || email !== allowed) return json({ error: "Sign in through Cloudflare Access first." }, 401);

  const parts = [].concat(params.path || []);
  const method = request.method;

  if (parts[0] === "health" && method === "GET") return json({ ok: true });

  let body = null;
  if (method === "PUT" || method === "POST") {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "Too large." }, 413);
    try { body = JSON.parse(text); } catch { return json({ error: "Send JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Send a JSON object." }, 400);
  }

  if (parts[0] === "doc") {
    const path = parts.slice(1).join("/");
    if (!DOCS.has(path)) return json({ error: "Unknown document." }, 404);
    if (method === "GET") return json(await env.DB.get("doc:" + path, "json"));
    if (method === "PUT") { await env.DB.put("doc:" + path, JSON.stringify(body)); return json({ ok: true }); }
    return json({ error: "Method not allowed." }, 405);
  }

  if (parts[0] === "col" && COLLECTIONS.has(parts[1])) {
    const key = "col:" + parts[1];
    const items = (await env.DB.get(key, "json")) || {};
    const id = parts[2];
    if (!id && method === "GET") {
      const list = Object.entries(items).map(([k, v]) => ({ id: k, ...v }));
      list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      return json(list);
    }
    if (!id && method === "POST") {
      if (Object.keys(items).length >= 2000) return json({ error: "The inbox is full. Delete some done ideas first." }, 507);
      const newId = crypto.randomUUID();
      items[newId] = body;
      await env.DB.put(key, JSON.stringify(items));
      return json({ id: newId }, 201);
    }
    if (id && method === "PUT") { items[id] = body; await env.DB.put(key, JSON.stringify(items)); return json({ ok: true }); }
    if (id && method === "DELETE") { delete items[id]; await env.DB.put(key, JSON.stringify(items)); return new Response(null, { status: 204 }); }
    return json({ error: "Method not allowed." }, 405);
  }

  return json({ error: "Not found." }, 404);
}
