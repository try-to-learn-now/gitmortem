// File: functions/api/meta.js
import { corsHeaders, pickToken, ghJson, resolveRefToCommitSha } from "./_utils.js";

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const refInput = url.searchParams.get("ref");
  const dir = (url.searchParams.get("dir") || "").replace(/^\/+/, "").replace(/\/+$/, "");

  if (!owner || !repo) return new Response("Missing owner/repo", { status: 400, headers: corsHeaders() });

  const token = pickToken(env, owner);
  if (!token) return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });

  const resolved = await resolveRefToCommitSha({ owner, repo, refInput, token });
  if (!resolved.ok) return new Response(`Ref Error: ${resolved.error}`, { status: resolved.status, headers: corsHeaders() });

  const { ref, commitSha } = resolved;

  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const { res: cRes, data: cJson } = await ghJson(commitUrl, token);
  if (!cRes.ok) return new Response(`Commit Error: ${cJson.message || cRes.statusText}`, { status: cRes.status, headers: corsHeaders() });

  const treeSha = cJson?.tree?.sha;
  if (!treeSha) return new Response("Missing tree sha", { status: 500, headers: corsHeaders() });

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const { res: tRes, data: treeJson } = await ghJson(treeUrl, token);
  if (!tRes.ok) return new Response(`Tree Error: ${treeJson.message || tRes.statusText}`, { status: tRes.status, headers: corsHeaders() });

  const prefix = dir ? `${dir}/` : "";
  const items = (treeJson.tree || [])
    .filter(x => x?.path)
    .filter(x => (prefix ? x.path.startsWith(prefix) : true))
    .map(x => ({
      path: x.path,
      type: x.type,      // "blob" or "tree"
      sha: x.sha,
      size: x.size ?? null,
      mode: x.mode ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const blobs = items.filter(x => x.type === "blob").length;
  const trees = items.filter(x => x.type === "tree").length;

  return new Response(JSON.stringify({
    owner, repo,
    ref,
    commitSha,
    dir: dir || "",
    counts: { total: items.length, blobs, trees },
    generatedAt: new Date().toISOString(),
    items,
  }, null, 2), {
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}
