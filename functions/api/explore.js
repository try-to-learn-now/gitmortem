// File: functions/api/explore.js
import { corsHeaders, pickToken, escHtml, escAttr, ghJson, resolveRefToCommitSha } from "./_utils.js";

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const refInput = url.searchParams.get("ref"); // optional

  if (!owner || !repo) {
    return new Response("Error: Missing owner/repo", { status: 400, headers: corsHeaders() });
  }

  const token = pickToken(env, owner);
  if (!token) {
    return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });
  }

  // Resolve ref→commit
  const resolved = await resolveRefToCommitSha({ owner, repo, refInput, token });
  if (!resolved.ok) {
    return new Response(`Tree Error: ${resolved.error}`, { status: resolved.status, headers: corsHeaders() });
  }
  const { ref, commitSha } = resolved;

  // commit -> tree sha
  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const { res: cRes, data: cJson } = await ghJson(commitUrl, token);
  if (!cRes.ok) {
    return new Response(`Tree Error: Commit fetch failed: ${cJson.message || cRes.statusText}`, {
      status: cRes.status, headers: corsHeaders(),
    });
  }

  const treeSha = cJson?.tree?.sha;
  if (!treeSha) {
    return new Response("Tree Error: Missing tree sha", { status: 500, headers: corsHeaders() });
  }

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const { res: tRes, data: treeJson } = await ghJson(treeUrl, token);
  if (!tRes.ok) {
    return new Response(`Tree Error: ${treeJson.message || tRes.statusText}`, {
      status: tRes.status, headers: corsHeaders(),
    });
  }

  // Build nested map
  const root = {};
  (treeJson.tree || []).forEach((item) => {
    if (!item?.path) return;
    const parts = item.path.split("/");
    let node = root;
    parts.forEach((part, idx) => {
      if (!node[part]) node[part] = { __children: {}, __isFile: false, path: null };
      const isLast = idx === parts.length - 1;
      if (isLast && item.type === "blob") {
        node[part].__isFile = true;
        node[part].path = item.path;
      }
      node = node[part].__children;
    });
  });

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

  folderEntries.push({ entry: { __children: root }, path: "" });
  walkFolders(root, "");
  folderEntries.sort((a, b) => (a.path === "" ? -1 : b.path === "" ? 1 : a.path.localeCompare(b.path)));

  const tip = `
<div style="margin-bottom:10px; padding:10px; border:1px solid #30363d; border-radius:10px; background:#161b22;">
  <div style="font-weight:700; margin-bottom:6px;">AI Tip (no truncation + no hallucination)</div>
  <div style="font-size:12px; color:#8b949e; line-height:1.5;">
    ✅ Links are commit-pinned: <code>${escHtml(commitSha)}</code><br>
    Chunk: <code>&amp;start=1&amp;end=400</code> then follow header <code>X-Next-Start</code> until -1.<br>
    Add <code>&amp;ln=1</code> for line numbers, <code>&amp;md=1</code> for code fences.<br>
    Verify with headers: <code>X-Commit-SHA</code>, <code>X-Full-SHA256</code>, <code>X-Body-SHA256</code>.
  </div>
  <div style="margin-top:6px; font-size:12px; color:#8b949e;">
    Repo: <b>${escHtml(owner)}/${escHtml(repo)}</b> • Ref: <b>${escHtml(ref)}</b> • Commit: <b>${escHtml(commitSha)}</b>
  </div>
</div>`;

  let html = tip;

  for (const f of folderEntries) {
    const folderPath = f.path;
    const title = folderPath ? `📁 ${folderPath}/` : "📁 (root)";

    const folderEntry = f.path === "" ? { __children: root } : f.entry;
    const { children, names } = listChildren(folderEntry);

    let out = "";
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const entry = children[name];
      const isLast = i === names.length - 1;
      const connector = isLast ? "└──" : "├──";

      if (entry.__isFile) {
        const fullUrl =
          `${url.origin}/api/get-code?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` +
          `&ref=${encodeURIComponent(commitSha)}&path=${encodeURIComponent(entry.path)}`;

        out += `${connector}  <span class="file-link" data-url="${escAttr(fullUrl)}" data-filename="${escAttr(name)}" data-path="${escAttr(entry.path)}">${escHtml(name)}</span>\n`;
        out += `    └─  ${escHtml(fullUrl)}\n`;
      } else {
        out += `${connector}  ${escHtml(name)}/\n`;
      }
    }
    if (!out) out = "(empty folder)\n";

    const dirParam = folderPath ? folderPath : "";
    const bundleUrl =
      `${url.origin}/api/bundle?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` +
      `&ref=${encodeURIComponent(commitSha)}&dir=${encodeURIComponent(dirParam)}&cursor=0&chunkFiles=20`;

    html += `
<div class="folder-panel">
  <div class="folder-panel-title">${escHtml(title)}</div>
  <div style="font-size:12px; color:#8b949e; margin:4px 0 6px;">
    Bundle (20 files/page): <span class="file-link" data-url="${escAttr(bundleUrl)}" data-filename="bundle" data-path="${escAttr(dirParam)}">${escHtml(bundleUrl)}</span>
  </div>
  <pre>${out}</pre>
</div>\n\n`;
  }

  return new Response(html, { headers: corsHeaders({ "Content-Type": "text/html; charset=utf-8" }) });
}
