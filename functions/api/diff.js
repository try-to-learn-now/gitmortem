// File: functions/api/diff.js
import { corsHeaders, pickToken, ghJson } from "./_utils.js";

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const base = url.searchParams.get("base"); // branch/tag/sha
  const head = url.searchParams.get("head"); // branch/tag/sha
  const pathPrefix = (url.searchParams.get("path") || "").replace(/^\/+/, "");

  if (!owner || !repo || !base || !head) {
    return new Response("Missing owner/repo/base/head", { status: 400, headers: corsHeaders() });
  }

  const token = pickToken(env, owner);
  if (!token) return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });

  const compareUrl = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const { res, data } = await ghJson(compareUrl, token);

  if (!res.ok) {
    return new Response(`Compare Error (${res.status}): ${data.message || res.statusText}`, {
      status: res.status,
      headers: corsHeaders(),
    });
  }

  const files = (data.files || [])
    .map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      blob_url: f.blob_url,
      raw_url: f.raw_url,
      patch: f.patch ? (f.patch.length > 2000 ? f.patch.slice(0, 2000) + "\n[PATCH TRUNCATED]" : f.patch) : null,
    }))
    .filter(f => (pathPrefix ? f.filename.startsWith(pathPrefix) : true));

  const out = {
    owner, repo,
    base, head,
    status: data.status,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    totalCommits: data.total_commits,
    commits: (data.commits || []).slice(0, 20).map(c => ({
      sha: c.sha,
      message: c.commit?.message?.split("\n")[0] || "",
      author: c.commit?.author?.name || "",
      date: c.commit?.author?.date || "",
    })),
    files,
  };

  return new Response(JSON.stringify(out, null, 2), {
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}
