// File: functions/api/explore.js
// Cloudflare Pages Function
// Features:
// - Multi-account token selection (TOKEN_<OWNER>, fallback TOKEN_DEFAULT)
// - Robust tree fetch: refs -> commit -> tree sha -> recursive tree
// - Outputs folder panels with file links to /api/get-code
// - Adds a clear tip for chunking large files (&start=&end, header X-Next-Start)
// - NO CACHE + CORS
// - Escapes HTML to avoid XSS from weird file names

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

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

function escAttr(s) {
  // attribute-safe
  return escHtml(s);
}

async function ghJson(url, token) {
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitMortem-Explorer",
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const refInput = url.searchParams.get("ref"); // optional: branch/tag/sha

  if (!owner || !repo) {
    return new Response("Error: Missing owner/repo", { status: 400, headers: corsHeaders() });
  }

  const token = pickToken(env, owner);
  if (!token) {
    return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });
  }

  console.log("========== GITMORTEM ==========");
  console.log("Owner:", owner);
  console.log("Repo:", repo);

  try {
    // 1) Repo info
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

    // 2) Resolve ref -> commit sha (try heads, then tags, then treat as sha)
    let commitSha = null;

    // heads
    {
      const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(ref)}`;
      const { res, data } = await ghJson(refUrl, token);
      if (res.ok && data && data.object && data.object.sha) commitSha = data.object.sha;
    }

    // tags
    if (!commitSha) {
      const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(ref)}`;
      const { res, data } = await ghJson(refUrl, token);
      if (res.ok && data && data.object && data.object.sha) commitSha = data.object.sha;
    }

    // fallback: assume ref itself is sha
    if (!commitSha && /^[0-9a-f]{7,40}$/i.test(ref)) {
      commitSha = ref;
    }

    if (!commitSha) {
      return new Response(`Tree Error: Could not resolve ref "${ref}"`, { status: 400, headers: corsHeaders() });
    }

    // 3) commit -> tree sha
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
    const { res: cRes, data: cJson } = await ghJson(commitUrl, token);
    if (!cRes.ok) {
      return new Response(`Tree Error: Commit fetch failed: ${cJson.message || cRes.statusText}`, {
        status: cRes.status,
        headers: corsHeaders(),
      });
    }

    const treeSha = cJson?.tree?.sha;
    if (!treeSha) {
      return new Response(`Tree Error: Missing tree sha`, { status: 500, headers: corsHeaders() });
    }

    // 4) recursive tree
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const { res: tRes, data: treeJson } = await ghJson(treeUrl, token);

    if (!tRes.ok) {
      return new Response(`Tree Error: ${treeJson.message || tRes.statusText}`, {
        status: tRes.status,
        headers: corsHeaders(),
      });
    }

    // Build nested map
    const root = {}; // virtual root

    (treeJson.tree || []).forEach((item) => {
      if (!item?.path) return;
      const parts = item.path.split("/");
      let node = root;

      parts.forEach((part, idx) => {
        if (!node[part]) {
          node[part] = {
            __children: {},
            __isFile: false,
            path: null,
          };
        }

        const isLast = idx === parts.length - 1;

        if (isLast && item.type === "blob") {
          node[part].__isFile = true;
          node[part].path = item.path;
        } else if (!isLast) {
          // ensure folder-like
          node[part].__isFile = false;
        }

        node = node[part].__children;
      });
    });

    // Helper: list immediate children (folders first, then files)
    const listChildren = (folderEntry) => {
      const children = folderEntry.__children || {};
      const names = Object.keys(children);

      names.sort((a, b) => {
        const aIsFile = children[a].__isFile;
        const bIsFile = children[b].__isFile;
        if (aIsFile !== bIsFile) return aIsFile - bIsFile;
        return a.localeCompare(b);
      });

      return { children, names };
    };

    // Collect all folders with full path
    const folderEntries = [];

    const walkFolders = (map, currentPath) => {
      for (const name of Object.keys(map)) {
        const entry = map[name];
        const path = currentPath ? `${currentPath}/${name}` : name;

        if (!entry.__isFile) {
          folderEntries.push({ entry, path });
          walkFolders(entry.__children || {}, path);
        }
      }
    };

    // push root as special folder ""
    folderEntries.push({ entry: { __children: root }, path: "" });
    walkFolders(root, "");

    // Sort folders: root first, then by path
    folderEntries.sort((a, b) => (a.path === "" ? -1 : b.path === "" ? 1 : a.path.localeCompare(b.path)));

    // Build HTML output
    const tip = `
<div style="margin-bottom:10px; padding:10px; border:1px solid #30363d; border-radius:10px; background:#161b22;">
  <div style="font-weight:600; margin-bottom:6px;">AI Tip (no truncation):</div>
  <div style="font-size:12px; color:#8b949e; line-height:1.5;">
    For big files use chunked reading:<br>
    <code>&amp;start=1&amp;end=400</code> then next chunk is in header <code>X-Next-Start</code>.<br>
    Add <code>&amp;ln=1</code> for line numbers, <code>&amp;md=1</code> for markdown code fences.
  </div>
  <div style="margin-top:6px; font-size:12px; color:#8b949e;">
    Repo: <b>${escHtml(owner)}/${escHtml(repo)}</b> • Ref: <b>${escHtml(ref)}</b>
  </div>
</div>`;

    let html = tip;

    for (const f of folderEntries) {
      const folderPath = f.path; // "" = root
      const title = folderPath ? `📁 ${folderPath}/` : "📁 (root)";

      // Build tree listing for this panel (immediate children only)
      const folderEntry = f.path === "" ? { __children: root } : f.entry;
      const { children, names } = listChildren(folderEntry);

      let out = "";
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const entry = children[name];
        const isLast = i === names.length - 1;
        const connector = isLast ? "└──" : "├──";

        if (entry.__isFile) {
          const fullUrl = `${url.origin}/api/get-code?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(entry.path)}`;

          out += `${connector}  <span class="file-link" data-url="${escAttr(fullUrl)}" data-filename="${escAttr(name)}" data-path="${escAttr(entry.path)}">${escHtml(name)}</span>\n`;
          out += `    └─  ${escHtml(fullUrl)}\n`;
        } else {
          out += `${connector}  ${escHtml(name)}/\n`;
        }
      }

      if (!out) out = "(empty folder)\n";

      // Add optional bundle link for this folder (AI can pull folder files in pages)
      const dirParam = folderPath ? folderPath : "";
      const bundleUrl = `${url.origin}/api/bundle?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&dir=${encodeURIComponent(dirParam)}&cursor=0&chunkFiles=20`;

      html += `
<div class="folder-panel">
  <div class="folder-panel-title">${escHtml(title)}</div>
  <div style="font-size:12px; color:#8b949e; margin:4px 0 6px;">
    Bundle this folder (20 files/page): <span class="file-link" data-url="${escAttr(bundleUrl)}" data-filename="bundle" data-path="${escAttr(dirParam)}">${escHtml(bundleUrl)}</span>
  </div>
  <pre>${out}</pre>
</div>\n\n`;
    }

    return new Response(html, {
      headers: corsHeaders({
        "Content-Type": "text/html; charset=utf-8",
      }),
    });
  } catch (e) {
    console.log("CRASH:", e);
    return new Response(`Server Crash: ${e.message}`, { status: 500, headers: corsHeaders() });
  }
}
