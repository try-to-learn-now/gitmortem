// File: functions/api/bundle.js
import {
  corsHeaders, pickToken, safeInt, normalizePath,
  sha256HexFromString, ghJson, resolveRefToCommitSha
} from "./_utils.js";

async function ghRawContents(owner, repo, path, token, commitSha) {
  const u = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
  u.searchParams.set("ref", commitSha);

  const res = await fetch(u.toString(), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": "GitMortem-AccuracyPack",
      "Accept": "application/vnd.github.v3.raw",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, status: res.status, text: `GitHub Error (${res.status}): ${err || res.statusText}` };
  }
  const text = await res.text();
  if (text.includes("\u0000")) return { ok: false, status: 415, text: "Binary file skipped." };
  return { ok: true, status: 200, text };
}

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const refInput = url.searchParams.get("ref"); // branch/tag/sha supported
  const dirRaw = url.searchParams.get("dir") || "";
  const dir = normalizePath(dirRaw).replace(/\/+$/, "");
  const cursor = Math.max(safeInt(url.searchParams.get("cursor"), 0), 0);
  const chunkFiles = Math.min(Math.max(safeInt(url.searchParams.get("chunkFiles"), 20), 1), 100);

  if (!owner || !repo) return new Response("Missing owner/repo", { status: 400, headers: corsHeaders() });

  const token = pickToken(env, owner);
  if (!token) return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });

  const resolved = await resolveRefToCommitSha({ owner, repo, refInput, token });
  if (!resolved.ok) return new Response(`Ref Error: ${resolved.error}`, { status: resolved.status, headers: corsHeaders() });

  const { ref, commitSha } = resolved;

  // commit -> tree sha
  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const { res: cRes, data: cJson } = await ghJson(commitUrl, token);
  if (!cRes.ok) return new Response(`Commit Error: ${cJson.message || cRes.statusText}`, { status: cRes.status, headers: corsHeaders() });

  const treeSha = cJson?.tree?.sha;
  if (!treeSha) return new Response("Missing tree sha", { status: 500, headers: corsHeaders() });

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const { res: tRes, data: treeJson } = await ghJson(treeUrl, token);
  if (!tRes.ok) return new Response(`Tree Error: ${treeJson.message || tRes.statusText}`, { status: tRes.status, headers: corsHeaders() });

  const prefix = dir ? `${dir}/` : "";
  const allFiles = (treeJson.tree || [])
    .filter(x => x?.type === "blob" && typeof x.path === "string")
    .filter(x => (prefix ? x.path.startsWith(prefix) : true))
    .map(x => x.path)
    .sort((a, b) => a.localeCompare(b));

  const totalFiles = allFiles.length;
  const slice = allFiles.slice(cursor, cursor + chunkFiles);
  const nextCursor = (cursor + slice.length) < totalFiles ? (cursor + slice.length) : -1;

  let out = "";
  out += `// GitMortem Bundle (commit pinned)\n`;
  out += `// source=${owner}/${repo}@${commitSha}\n`;
  out += `// dir=${dir || "(root)"}\n`;
  out += `// files ${cursor + 1}-${Math.min(cursor + slice.length, totalFiles)} of ${totalFiles}\n`;
  out += `// next cursor in header: X-Next-Cursor\n\n`;

  for (const filePath of slice) {
    out += `// ===== File: ${filePath} =====\n`;
    const r = await ghRawContents(owner, repo, filePath, token, commitSha);
    if (!r.ok) out += `// [SKIP] ${r.text}\n\n`;
    else out += r.text + "\n\n";
  }

  const bodySha = await sha256HexFromString(out);

  return new Response(out, {
    headers: corsHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "X-Ref": ref,
      "X-Commit-SHA": commitSha,
      "X-Source": `${owner}/${repo}@${commitSha}:${dir || ""}`,
      "X-Total-Files": String(totalFiles),
      "X-Chunk-Files": String(chunkFiles),
      "X-Cursor": String(cursor),
      "X-Next-Cursor": String(nextCursor),
      "X-Body-SHA256": bodySha,
    }),
  });
}
