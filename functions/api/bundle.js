// File: functions/api/bundle.js
// Cloudflare Pages Function
// Bundle files under a directory (dir) into one plain text response.
// Uses cursor pagination by file count (chunkFiles).
// Still NO CACHE and keeps multi-account token logic.

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function pickToken(env, owner) {
  const cleanOwner = String(owner || "").toUpperCase().replace(/-/g, "_");
  return env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT || "";
}

function safeInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function ghJson(url, token) {
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitMortem-Bundler",
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function ghRawContents(owner, repo, path, token) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(apiUrl, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": "Mozilla/5.0 (GitMortem-Bundler)",
      "Accept": "application/vnd.github.v3.raw",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, status: res.status, text: `GitHub Error (${res.status}): ${err || res.statusText}` };
  }
  const text = await res.text();
  if (text.includes("\u0000")) {
    return { ok: false, status: 415, text: "Binary file skipped." };
  }
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
  const dir = (url.searchParams.get("dir") || "").replace(/^\/+/, "").replace(/\/+$/, ""); // normalize
  const cursor = Math.max(safeInt(url.searchParams.get("cursor"), 0), 0);
  const chunkFiles = Math.min(Math.max(safeInt(url.searchParams.get("chunkFiles"), 20), 1), 100); // 1..100
  const refInput = url.searchParams.get("ref"); // optional

  if (!owner || !repo) {
    return new Response("Missing owner/repo", { status: 400, headers: corsHeaders() });
  }

  const token = pickToken(env, owner);
  if (!token) {
    return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });
  }

  try {
    // Repo info + resolve ref (same approach as explore.js)
    const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const { res: repoRes, data: repoInfo } = await ghJson(repoInfoUrl, token);
    if (!repoRes.ok) {
      return new Response(`RepoInfo Error: ${repoInfo.message || repoRes.statusText}`, {
        status: repoRes.status,
        headers: corsHeaders(),
      });
    }

    const defaultBranch = repoInfo.default_branch || "main";
    const ref = refInput || defaultBranch;

    // Resolve to commit sha
    let commitSha = null;
    {
      const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(ref)}`;
      const { res, data } = await ghJson(refUrl, token);
      if (res.ok && data?.object?.sha) commitSha = data.object.sha;
    }
    if (!commitSha) {
      const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(ref)}`;
      const { res, data } = await ghJson(refUrl, token);
      if (res.ok && data?.object?.sha) commitSha = data.object.sha;
    }
    if (!commitSha && /^[0-9a-f]{7,40}$/i.test(ref)) commitSha = ref;

    if (!commitSha) {
      return new Response(`Could not resolve ref "${ref}"`, { status: 400, headers: corsHeaders() });
    }

    // commit -> tree sha
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
    const { res: cRes, data: cJson } = await ghJson(commitUrl, token);
    if (!cRes.ok) {
      return new Response(`Commit Error: ${cJson.message || cRes.statusText}`, { status: cRes.status, headers: corsHeaders() });
    }
    const treeSha = cJson?.tree?.sha;
    if (!treeSha) return new Response("Missing tree sha", { status: 500, headers: corsHeaders() });

    // recursive tree
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const { res: tRes, data: treeJson } = await ghJson(treeUrl, token);
    if (!tRes.ok) {
      return new Response(`Tree Error: ${treeJson.message || tRes.statusText}`, { status: tRes.status, headers: corsHeaders() });
    }

    // Filter blobs under dir
    const prefix = dir ? `${dir}/` : "";
    const allFiles = (treeJson.tree || [])
      .filter((x) => x?.type === "blob" && typeof x.path === "string")
      .map((x) => x.path)
      .filter((p) => (prefix ? p.startsWith(prefix) : true))
      .sort((a, b) => a.localeCompare(b));

    const totalFiles = allFiles.length;
    const slice = allFiles.slice(cursor, cursor + chunkFiles);

    let out = "";
    out += `// GitMortem Bundle\n`;
    out += `// repo=${owner}/${repo} ref=${ref}\n`;
    out += `// dir=${dir || "(root)"}\n`;
    out += `// files ${cursor + 1}-${Math.min(cursor + slice.length, totalFiles)} of ${totalFiles}\n`;
    out += `// next cursor in header: X-Next-Cursor\n\n`;

    for (const filePath of slice) {
      out += `// ===== File: ${filePath} =====\n`;
      const r = await ghRawContents(owner, repo, filePath, token);
      if (!r.ok) {
        out += `// [SKIP] ${r.text}\n\n`;
      } else {
        out += r.text + `\n\n`;
      }
    }

    const nextCursor = cursor + slice.length < totalFiles ? cursor + slice.length : -1;

    return new Response(out, {
      headers: corsHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "X-Owner": owner,
        "X-Repo": repo,
        "X-Ref": ref,
        "X-Dir": dir,
        "X-Total-Files": String(totalFiles),
        "X-Chunk-Files": String(chunkFiles),
        "X-Cursor": String(cursor),
        "X-Next-Cursor": String(nextCursor),
      }),
    });
  } catch (e) {
    return new Response(`Bundle Crash: ${e.message}`, { status: 500, headers: corsHeaders() });
  }
}
