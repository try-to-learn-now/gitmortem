// File: public/app.js
// GitMortem Explorer UI (Accuracy Pack + Option A)
// Adds 🧠 "Copy AI Prompt" that copies strict anti-hallucination rules + pinned commit + tree.
// Fixes UNKNOWN_COMMIT by extracting commit reliably (tree tip + currentProof fallback).

const repoInput = document.getElementById("repo-url");
const refInput = document.getElementById("ref");

const loadBtn = document.getElementById("load-btn");
const clearBtn = document.getElementById("clear-btn");

const statusEl = document.getElementById("status");
const treeBox = document.getElementById("tree");
const previewBox = document.getElementById("preview-box");

const copyTreeBtn = document.getElementById("copy-tree-btn");
const copyAiBtn = document.getElementById("copy-ai-btn");

const copyPreviewBtn = document.getElementById("copy-preview-btn");
const openPreviewBtn = document.getElementById("open-preview-btn");
const nextChunkBtn = document.getElementById("next-chunk-btn");
const allChunksBtn = document.getElementById("all-chunks-btn");
const toggleLn = document.getElementById("toggle-ln");

let currentBaseUrl = "";   // /api/get-code?... or /api/bundle?...
let currentLabel = "";     // file path / bundle label
let nextStart = -1;        // for get-code chunking
let nextCursor = -1;       // for bundle paging
let previewIsBundle = false;

let currentProof = null;   // {commitSha, source, fullSha, bodySha, ...}

function escapeHtml(txt) {
  return String(txt).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

function parseRepoInput(input) {
  const s = input.trim();

  if (/^[^\/\s]+\/[^\/\s]+$/.test(s)) {
    const [owner, repo] = s.split("/");
    return { owner, repo };
  }

  const u = new URL(s);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Invalid GitHub URL");
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
}

function buildExploreUrl(owner, repo) {
  const ref = (refInput?.value || "").trim();
  let url = `/api/explore?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
  if (ref) url += `&ref=${encodeURIComponent(ref)}`;
  return url;
}

function withLnParam(urlStr) {
  if (!toggleLn || !toggleLn.checked) return urlStr;
  const u = new URL(urlStr, window.location.origin);
  u.searchParams.set("ln", "1");
  return u.pathname + "?" + u.searchParams.toString();
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function setPreviewText(text) {
  previewBox.innerHTML = `<pre><code class="language-text">${escapeHtml(text)}</code></pre>`;
  if (window.hljs) hljs.highlightAll();
}

function header(res, name) {
  return res.headers.get(name) || "";
}

function buildProofBlock(proof) {
  return (
    `// PROOF\n` +
    `// X-Commit-SHA: ${proof.commitSha || "?"}\n` +
    `// X-Source: ${proof.source || "?"}\n` +
    (proof.fullSha ? `// X-Full-SHA256: ${proof.fullSha}\n` : "") +
    (proof.bodySha ? `// X-Body-SHA256: ${proof.bodySha}\n` : "") +
    (proof.range ? `// X-Range: ${proof.range}\n` : "") +
    (proof.totalLines ? `// X-Total-Lines: ${proof.totalLines}\n` : "") +
    (proof.nextStart !== undefined && proof.nextStart !== null ? `// X-Next-Start: ${proof.nextStart}\n` : "") +
    (proof.totalFiles ? `// X-Total-Files: ${proof.totalFiles}\n` : "") +
    (proof.cursor ? `// X-Cursor: ${proof.cursor}\n` : "") +
    (proof.nextCursor !== undefined && proof.nextCursor !== null ? `// X-Next-Cursor: ${proof.nextCursor}\n` : "") +
    `\n`
  );
}

function extractProofHeaders(res, mode) {
  const commitSha = header(res, "X-Commit-SHA");
  const source = header(res, "X-Source");
  const fullSha = header(res, "X-Full-SHA256");
  const bodySha = header(res, "X-Body-SHA256") || header(res, "X-Chunk-SHA256");

  const proof = { commitSha, source, fullSha, bodySha };

  if (mode === "file") {
    proof.range = header(res, "X-Range");
    proof.totalLines = header(res, "X-Total-Lines");
    proof.nextStart = header(res, "X-Next-Start");
  } else {
    proof.totalFiles = header(res, "X-Total-Files");
    proof.cursor = header(res, "X-Cursor");
    proof.nextCursor = header(res, "X-Next-Cursor");
  }

  return proof;
}

// ------- Option A: Strict AI prompt + pinned commit + tree -------

// Strong commit extraction:
// 1) If you've opened any file, currentProof.commitSha is perfect.
// 2) Else parse from tree tip lines.
function getPinnedCommit() {
  if (currentProof && currentProof.commitSha && /^[0-9a-f]{40}$/i.test(currentProof.commitSha)) {
    return currentProof.commitSha;
  }

  const text = treeBox?.innerText || "";

  // Most reliable: "commit-pinned:" line in tip
  const m1 = text.match(/commit-pinned:\s*([0-9a-f]{40})/i);
  if (m1 && m1[1]) return m1[1];

  // Also appears as "Commit: <sha>"
  const m2 = text.match(/Commit:\s*([0-9a-f]{40})/i);
  if (m2 && m2[1]) return m2[1];

  // Fallback: any sha
  const m3 = text.match(/[0-9a-f]{40}/i);
  if (m3) return m3[0];

  return "UNKNOWN_COMMIT";
}

function buildStrictAiInstructionBlock() {
  const commit = getPinnedCommit();
  return (
`STRICT RULES (GitMortem):
1) Only use what matches X-Commit-SHA and X-Full-SHA256 shown in the PROOF block.
2) If something is not present in provided code chunks, reply exactly: NOT IN PROVIDED CODE
3) Every claim must include line numbers (ln=1) OR chunk ranges (X-Range).
4) If more code is needed, request the next chunk using X-Next-Start / X-Next-Cursor.

Pinned Commit (proof anchor): ${commit}

--- REPO TREE (copy/paste links below) ---
`);
}

copyAiBtn?.addEventListener("click", () => {
  if (!treeBox || !treeBox.innerText.trim()) {
    setStatus("❌ Tree not loaded yet. Click Generate Tree first.");
    return;
  }
  const payload = buildStrictAiInstructionBlock() + (treeBox?.innerText || "");
  navigator.clipboard?.writeText(payload).catch(() => {});
  setStatus("✅ Copied strict AI rules + pinned commit + tree.");
});

// ---- Tree Load ----
loadBtn?.addEventListener("click", async () => {
  const input = (repoInput?.value || "").trim();
  if (!input) return alert("Enter GitHub repo URL (or owner/repo)");

  setPreviewText("Select a file from tree above…");
  treeBox.textContent = "";
  setStatus("⏳ Fetching tree...");

  try {
    const { owner, repo } = parseRepoInput(input);
    const res = await fetch(buildExploreUrl(owner, repo));
    const html = await res.text();

    if (!res.ok || html.startsWith("Error:") || html.startsWith("RepoInfo Error") || html.startsWith("Tree Error")) {
      throw new Error(html || `Failed (${res.status})`);
    }

    setStatus("✅ Done! Copy tree for AI or click a file to preview.");
    treeBox.innerHTML = html;
    wireFolderPanels();
  } catch (err) {
    setStatus("❌ Failed");
    treeBox.textContent = err.message || String(err);
  }
});

clearBtn?.addEventListener("click", () => {
  treeBox.textContent = "";
  setPreviewText("Select a file from tree above…");
  setStatus("Waiting…");
  currentBaseUrl = "";
  currentLabel = "";
  nextStart = -1;
  nextCursor = -1;
  previewIsBundle = false;
  currentProof = null;
});

// ---- Folder Panel Buttons ----
function wireFolderPanels() {
  document.querySelectorAll(".folder-panel").forEach((panel) => {
    if (panel.dataset.wired === "1") return;
    panel.dataset.wired = "1";

    const titleEl = panel.querySelector(".folder-panel-title");
    if (!titleEl) return;

    const actions = document.createElement("span");
    actions.style.float = "right";
    actions.style.display = "flex";
    actions.style.gap = "6px";

    const copyBtn = document.createElement("button");
    copyBtn.className = "icon-btn";
    copyBtn.title = "Copy this folder panel";
    copyBtn.textContent = "📋";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard?.writeText(panel.innerText).catch(() => {});
    });

    const mergeBtn = document.createElement("button");
    mergeBtn.className = "icon-btn merge";
    mergeBtn.title = "Load whole folder via bundle endpoint";
    mergeBtn.textContent = "⇪";
    mergeBtn.addEventListener("click", () => {
      const bundleLink = panel.querySelector(".file-link[data-filename='bundle']");
      if (!bundleLink) {
        setPreviewText("No bundle link found in this panel.");
        return;
      }
      loadBundlePage(bundleLink.dataset.url, "bundle");
    });

    actions.appendChild(copyBtn);
    actions.appendChild(mergeBtn);
    titleEl.appendChild(actions);
  });
}

// ---- Delegated clicks for file links ----
treeBox?.addEventListener("click", async (e) => {
  const target = e.target;
  if (!target.classList || !target.classList.contains("file-link")) return;

  const url = target.dataset.url;
  const filePath = target.dataset.path || target.dataset.filename || "File";
  if (!url) return;

  if (url.includes("/api/bundle")) {
    loadBundlePage(url, filePath);
    return;
  }

  loadFileFirstChunk(url, filePath);
});

// ---- Preview action buttons ----
copyTreeBtn?.addEventListener("click", () => {
  navigator.clipboard?.writeText(treeBox.innerText || "").catch(() => {});
});

copyPreviewBtn?.addEventListener("click", () => {
  navigator.clipboard?.writeText(previewBox.innerText || "").catch(() => {});
});

openPreviewBtn?.addEventListener("click", () => {
  if (!currentBaseUrl) return;
  window.open(currentBaseUrl, "_blank");
});

toggleLn?.addEventListener("change", () => {
  if (!currentBaseUrl) return;
  if (previewIsBundle) loadBundlePage(currentBaseUrl, currentLabel, false);
  else loadFileFirstChunk(currentBaseUrl, currentLabel);
});

nextChunkBtn?.addEventListener("click", async () => {
  if (!currentBaseUrl) return;

  if (previewIsBundle) {
    if (nextCursor === -1 || nextCursor === "-1") {
      setStatus("✅ Bundle already complete.");
      return;
    }
    const u = new URL(currentBaseUrl, window.location.origin);
    u.searchParams.set("cursor", String(nextCursor));
    loadBundlePage(u.pathname + "?" + u.searchParams.toString(), currentLabel, true);
    return;
  }

  if (nextStart === -1 || nextStart === "-1") {
    setStatus("✅ File already complete.");
    return;
  }

  await appendFileChunk(currentBaseUrl, currentLabel, Number(nextStart));
});

allChunksBtn?.addEventListener("click", async () => {
  if (!currentBaseUrl) return;

  if (previewIsBundle) {
    let url = currentBaseUrl;
    let guard = 0;
    while (guard++ < 400) {
      const done = await loadBundlePage(url, currentLabel, true);
      if (done) break;
      const u = new URL(url, window.location.origin);
      u.searchParams.set("cursor", String(nextCursor));
      url = u.pathname + "?" + u.searchParams.toString();
      if (nextCursor === -1 || nextCursor === "-1") break;
    }
    return;
  }

  let guard = 0;
  while ((nextStart !== -1 && nextStart !== "-1") && guard++ < 1000) {
    await appendFileChunk(currentBaseUrl, currentLabel, Number(nextStart));
  }
});

// ---- File chunked loader ----
function makeChunkUrl(baseUrl, start, end) {
  const u = new URL(withLnParam(baseUrl), window.location.origin);
  u.searchParams.set("start", String(start));
  u.searchParams.set("end", String(end));
  return u.pathname + "?" + u.searchParams.toString();
}

async function loadFileFirstChunk(baseUrl, label) {
  previewIsBundle = false;
  currentBaseUrl = baseUrl;
  currentLabel = label;

  currentProof = null;
  nextStart = -1;

  setPreviewText(`⏳ Loading ${label} (chunk 1)...`);
  setStatus("⏳ Loading file...");

  const chunkUrl = makeChunkUrl(baseUrl, 1, 400);
  const res = await fetch(chunkUrl);
  const text = await res.text();

  if (!res.ok) {
    setPreviewText(text || `Failed (${res.status})`);
    setStatus("❌ Failed");
    nextStart = -1;
    return;
  }

  const proof = extractProofHeaders(res, "file");
  currentProof = proof;

  nextStart = header(res, "X-Next-Start") || "-1";
  const range = header(res, "X-Range") || "";
  const total = header(res, "X-Total-Lines") || "";

  const proofBlock = buildProofBlock({ ...proof, range, totalLines: total, nextStart });

  const wrapped =
    proofBlock +
    `// File: ${label}\n` +
    `// Lines: ${range}/${total}\n` +
    `// NextStart: ${nextStart}\n\n` +
    text;

  setPreviewText(wrapped);

  setStatus((nextStart === "-1" || nextStart === -1) ? "✅ File complete." : "✅ Loaded first chunk. Use ➕ / ⇪ for more.");
}

async function appendFileChunk(baseUrl, label, startLine) {
  const endLine = startLine + 399;
  setStatus(`⏳ Loading next chunk (${startLine}-${endLine})...`);

  const chunkUrl = makeChunkUrl(baseUrl, startLine, endLine);
  const res = await fetch(chunkUrl);
  const text = await res.text();

  if (!res.ok) {
    setStatus("❌ Failed chunk");
    return;
  }

  const proof = extractProofHeaders(res, "file");
  const newNext = header(res, "X-Next-Start") || "-1";
  nextStart = newNext;

  const current = previewBox.innerText || "";
  const chunkProof =
    `\n\n// CHUNK PROOF\n` +
    `// X-Range: ${proof.range || "?"}\n` +
    `// X-Body-SHA256: ${proof.bodySha || "?"}\n` +
    `// X-Next-Start: ${newNext}\n\n`;

  const appended =
    current +
    `\n\n// -------- chunk ${startLine}-${endLine} --------\n` +
    chunkProof +
    text;

  setPreviewText(appended);

  setStatus((nextStart === "-1" || nextStart === -1) ? "✅ File complete." : "✅ Chunk appended. More available.");
}

// ---- Bundle loader ----
async function loadBundlePage(bundleUrl, label, append = false) {
  previewIsBundle = true;
  currentBaseUrl = bundleUrl;
  currentLabel = label;

  if (!append) {
    currentProof = null;
    nextCursor = -1;
    setPreviewText(`⏳ Loading bundle page...`);
  }
  setStatus("⏳ Loading bundle...");

  const res = await fetch(withLnParam(bundleUrl));
  const text = await res.text();

  if (!res.ok) {
    setPreviewText(text || `Failed (${res.status})`);
    setStatus("❌ Failed");
    nextCursor = -1;
    return true;
  }

  const proof = extractProofHeaders(res, "bundle");
  if (!append) currentProof = proof;

  nextCursor = header(res, "X-Next-Cursor") || "-1";

  const current = append ? (previewBox.innerText || "") : "";

  const proofBlock = append
    ? `\n\n// BUNDLE PAGE PROOF\n// X-Body-SHA256: ${proof.bodySha || "?"}\n// X-Next-Cursor: ${nextCursor}\n\n`
    : buildProofBlock({ ...proof, nextCursor });

  const merged = append
    ? (current + "\n\n// ===== NEXT BUNDLE PAGE =====\n" + proofBlock + text)
    : (proofBlock + text);

  setPreviewText(merged);

  setStatus((nextCursor === "-1" || nextCursor === -1) ? "✅ Bundle complete." : "✅ Bundle page loaded. Use ➕ / ⇪ for more.");
  return (nextCursor === "-1" || nextCursor === -1);
            }
