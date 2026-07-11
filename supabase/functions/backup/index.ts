import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors } });
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
async function isAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const key = req.headers.get("x-backup-key");
  if (key && key === Deno.env.get("BACKUP_SECRET")) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return false;
  const { data: p } = await sb.from("profiles").select("role,is_active").eq("id", data.user.id).single();
  return !!p && p.role === "admin" && p.is_active;
}
async function setKV(sb: ReturnType<typeof admin>, key: string, value: string) {
  await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------- Google Drive (service account) ----------
function b64url(bytes: Uint8Array) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem: string) {
  const b = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}
async function googleToken(saJson: string) {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + b64url(new Uint8Array(sig));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(d.error_description || d.error || "google auth failed");
  return d.access_token as string;
}
async function driveUpload(token: string, folderId: string, filename: string, content: string) {
  const boundary = "bkp" + Date.now();
  const meta: Record<string, unknown> = { name: filename };
  if (folderId) meta.parents = [folderId];
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body,
  });
  if (!res.ok) throw new Error("drive upload " + res.status + ": " + (await res.text()).slice(0, 200));
  return await res.json();
}

const TABLES = ["app_settings", "profiles", "bookings", "slots", "tasks", "task_photos"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  if (!(await isAdmin(req, sb))) return json({ error: "Unauthorized" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* cron may send empty */ }
  const action = String(body.action || "db");

  try {
    if (action === "db") {
      const dump: Record<string, unknown> = { _meta: { project: "jayaclean", at: new Date().toISOString() } };
      let total = 0;
      for (const t of TABLES) {
        const { data } = await sb.from(t).select("*");
        dump[t] = data || [];
        total += (data || []).length;
      }
      const content = JSON.stringify(dump);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const path = `db/db-backup-${ts}.json`;
      const up = await sb.storage.from("backups").upload(path, new Blob([content], { type: "application/json" }), { contentType: "application/json", upsert: true });
      if (up.error) throw new Error("storage: " + up.error.message);

      let drive = "skipped";
      const sa = Deno.env.get("GOOGLE_SA_JSON");
      const folder = Deno.env.get("GDRIVE_FOLDER_ID") || "";
      if (sa) {
        try {
          const tk = await googleToken(sa);
          await driveUpload(tk, folder, `db-backup-${ts}.json`, content);
          drive = "ok";
        } catch (e) { drive = "error: " + (e as Error).message; }
      }
      const status = `ok (${total} rows, storage:ok, drive:${drive})`;
      await setKV(sb, "backup_last_db_at", new Date().toISOString());
      await setKV(sb, "backup_last_db_status", status);
      return json({ status: "ok", data: { path, rows: total, drive } });
    }

    if (action === "list") {
      const { data, error } = await sb.storage.from("backups").list("db", { limit: 60, sortBy: { column: "name", order: "desc" } });
      if (error) throw new Error(error.message);
      const items = [];
      for (const f of data || []) {
        const s = await sb.storage.from("backups").createSignedUrl("db/" + f.name, 3600);
        items.push({ name: f.name, size: (f.metadata as any)?.size ?? null, url: s.data?.signedUrl ?? null });
      }
      return json({ status: "ok", data: items });
    }

    if (action === "code") {
      const ghpat = Deno.env.get("GH_PAT");
      if (!ghpat) return json({ error: "GH_PAT not configured" }, 400);
      const res = await fetch("https://api.github.com/repos/banktif/jayaclean-salespage/actions/workflows/mirror-to-gitlab.yml/dispatches", {
        method: "POST",
        headers: { Authorization: "Bearer " + ghpat, Accept: "application/vnd.github+json", "User-Agent": "jayaclean-backup", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "master" }),
      });
      const ok = res.status === 204;
      await setKV(sb, "backup_last_code_at", new Date().toISOString());
      await setKV(sb, "backup_last_code_status", ok ? "triggered" : ("error " + res.status));
      if (!ok) return json({ error: "dispatch failed", detail: (await res.text()).slice(0, 200) }, 502);
      return json({ status: "ok", data: { triggered: true } });
    }

    if (action === "status") {
      const { data } = await sb.from("app_settings").select("key,value").in("key", ["backup_enabled", "backup_last_db_at", "backup_last_db_status", "backup_last_code_at", "backup_last_code_status", "gdrive_folder_id"]);
      const m: Record<string, string> = {};
      (data || []).forEach((r: any) => (m[r.key] = r.value));
      return json({ status: "ok", data: m });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "Internal error", detail: (e as Error).message }, 500);
  }
});
