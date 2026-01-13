// File: public/app.js

const repoInput = document.getElementById("repo-url");
const refInput = document.getElementById("ref");

const loadBtn = document.getElementById("load-btn");
const clearBtn = document.getElementById("clear-btn");

const statusEl = document.getElementById("status");
const treeBox = document.getElementById("tree");
const previewBox = document.getElementById("preview-box");

const copyTreeBtn = document.getElementById("copy-tree-btn");
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

function escapeHtml(txt) {
  return String(txt).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c])
  );
}

function parseRepoInput(input) {
  const s = input.trim();

  // Allow shorthand: owner/repo
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
  const ref = refInput.value.trim();
  let url = `/api/explore?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
  if (ref) url += `&ref=${encodeURIComponent(ref)}`;
  return url;
}

function withLnParam(url) {
  if (!toggleLn.checked) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("ln", "1");
  return u.pathname + "?" + u.searchParams.toString();
}

// ---- Tree Load ----
loadBtn.addEventListener("click", async () => {
  const input = repoInput.value.trim();
  if (!input) return alert("Enter GitHub repo URL (or owner/repo)");

  previewBox.textContent = "Select a file from tree above…";
  treeBox.textContent = "";
  statusEl.textContent = "⏳ Fetching tree...";

  try {
    const { owner, repo } = parseRepoInput(input);
    const res = await fetch(buildExploreUrl(owner, repo));
    const text = await res.text();

    if (text.startsWith("Error:") || text.startsWith("RepoInfo Error") || text.startsWith("Tree Error")) {
      throw new Error(text);
    }

    statusEl.textContent = "✅ Done! Copy tree for AI or click a file to preview.";
    treeBox.innerHTML = text;
    wireFolderPanels();
  } catch (err) {
    statusEl.textContent = "❌ Failed";
    treeBox.textContent = err.message;
  }
});

clearBtn.addEventListener("click", () => {
  treeBox.textContent = "";
  previewBox.textContent = "Select a file from tree above…";
  statusEl.textContent = "Waiting…";
  currentBaseUrl = "";
  currentLabel = "";
  nextStart = -1;
  nextCursor = -1;
  previewIsBundle = false;
});

// ---- Folder Panel Buttons ----
function wireFolderPanels() {
  document.querySelectorAll(".folder-panel").forEach(panel => {
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
      // Find the first bundle link inside the panel (we render it in explore.js)
      const bundleLink = panel.querySelector(".file-link[data-filename='bundle']");
      if (!bundleLink) {
        previewBox.textContent = "No bundle link found in this panel.";
        return;
      }
      const url = bundleLink.dataset.url;
      loadBundlePage(url, "bundle");
    });

    actions.appendChild(copyBtn);
    actions.appendChild(mergeBtn);
    titleEl.appendChild(actions);
  });
}

// ---- Delegated clicks for file links ----
treeBox.addEventListener("click", async (e) => {
  const target = e.target;
  if (!target.classList.contains("file-link")) return;

  const url = target.dataset.url;
  const filePath = target.dataset.path || target.dataset.filename || "File";
  if (!url) return;

  // If this is a bundle URL, handle it differently
  if (url.includes("/api/bundle")) {
    loadBundlePage(url, filePath);
    return;
  }

  loadFileFirstChunk(url, filePath);
});

// ---- Preview action buttons ----
copyTreeBtn.addEventListener("click", () => {
  navigator.clipboard?.writeText(treeBox.innerText || "").catch(() => {});
});

copyPreviewBtn.addEventListener("click", () => {
  navigator.clipboard?.writeText(previewBox.innerText || "").catch(() => {});
});

openPreviewBtn.addEventListener("click", () => {
  if (!currentBaseUrl) return;
  window.open(currentBaseUrl, "_blank");
});

toggleLn.addEventListener("change", () => {
  // reload current view
  if (!currentBaseUrl) return;
  if (previewIsBundle) {
    loadBundlePage(currentBaseUrl, currentLabel);
  } else {
    loadFileFirstChunk(currentBaseUrl, currentLabel);
  }
});

nextChunkBtn.addEventListener("click", async () => {
  if (!currentBaseUrl) return;

  if (previewIsBundle) {
    if (nextCursor === -1) {
      statusEl.textContent = "✅ Bundle already complete.";
      return;
    }
    const u = new URL(currentBaseUrl, window.location.origin);
    u.searchParams.set("cursor", String(nextCursor));
    loadBundlePage(u.pathname + "?" + u.searchParams.toString(), currentLabel, true);
    return;
  }

  if (nextStart === -1) {
    statusEl.textContent = "✅ File already complete.";
    return;
  }
  await appendFileChunk(currentBaseUrl, currentLabel, nextStart);
});

allChunksBtn.addEventListener("click", async () => {
  if (!currentBaseUrl) return;

  if (previewIsBundle) {
    // load until done
    let url = currentBaseUrl;
    let guard = 0;
    while (guard++ < 200) {
      const done = await loadBundlePage(url, currentLabel, true);
      if (done) break;
      const u = new URL(url, window.location.origin);
      u.searchParams.set("cursor", String(nextCursor));
      url = u.pathname + "?" + u.searchParams.toString();
      if (nextCursor === -1) break;
    }
    return;
  }

  // load file chunks until done
  let guard = 0;
  while (nextStart !== -1 && guard++ < 500) {
    await appendFileChunk(currentBaseUrl, currentLabel, nextStart);
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

  previewBox.textContent = `⏳ Loading ${label} (chunk 1)...`;
  statusEl.textContent = "⏳ Loading file...";

  // first chunk: 1..400 lines
  const chunkUrl = makeChunkUrl(baseUrl, 1, 400);
  const res = await fetch(chunkUrl);
  const text = await res.text();

  if (!res.ok) {
    previewBox.textContent = text;
    statusEl.textContent = "❌ Failed";
    nextStart = -1;
    return;
  }

  nextStart = parseInt(res.headers.get("X-Next-Start") || "-1", 10);
  const range = res.headers.get("X-Range") || "";
  const total = res.headers.get("X-Total-Lines") || "";

  const wrapped = `// File: ${label}\n// Lines: ${range}/${total}\n// NextStart: ${nextStart}\n\n${text}`;
  previewBox.innerHTML = `<pre><code>${escapeHtml(wrapped)}</code></pre>`;
  if (window.hljs) hljs.highlightAll();

  statusEl.textContent = nextStart === -1 ? "✅ File complete." : "✅ Loaded first chunk. Use ➕ / ⇪ for more.";
}

async function appendFileChunk(baseUrl, label, startLine) {
  const endLine = startLine + 399;
  statusEl.textContent = `⏳ Loading next chunk (${startLine}-${endLine})...`;

  const chunkUrl = makeChunkUrl(baseUrl, startLine, endLine);
  const res = await fetch(chunkUrl);
  const text = await res.text();

  if (!res.ok) {
    statusEl.textContent = "❌ Failed chunk";
    return;
  }

  const newNext = parseInt(res.headers.get("X-Next-Start") || "-1", 10);
  nextStart = newNext;

  // Append to existing code text
  const current = previewBox.innerText || "";
  const appended =
    current +
    `\n\n// -------- chunk ${startLine}-${Math.min(endLine, parseInt(res.headers.get("X-Total-Lines") || "0", 10) || endLine)} --------\n\n` +
    text;

  previewBox.innerHTML = `<pre><code>${escapeHtml(appended)}</code></pre>`;
  if (window.hljs) hljs.highlightAll();

  statusEl.textContent = nextStart === -1 ? "✅ File complete." : "✅ Chunk appended. More available.";
}

// ---- Bundle loader ----
async function loadBundlePage(bundleUrl, label, append = false) {
  previewIsBundle = true;
  currentBaseUrl = bundleUrl;
  currentLabel = label;

  if (!append) {
    previewBox.textContent = `⏳ Loading bundle page...`;
  }
  statusEl.textContent = "⏳ Loading bundle...";

  const res = await fetch(withLnParam(bundleUrl));
  const text = await res.text();

  if (!res.ok) {
    previewBox.textContent = text;
    statusEl.textContent = "❌ Failed";
    nextCursor = -1;
    return true;
  }

  nextCursor = parseInt(res.headers.get("X-Next-Cursor") || "-1", 10);

  const current = append ? (previewBox.innerText || "") : "";
  const merged = append ? (current + "\n\n// ===== NEXT BUNDLE PAGE =====\n\n" + text) : text;

  previewBox.innerHTML = `<pre><code>${escapeHtml(merged)}</code></pre>`;
  if (window.hljs) hljs.highlightAll();

  statusEl.textContent = nextCursor === -1 ? "✅ Bundle complete." : "✅ Bundle page loaded. Use ➕ / ⇪ for more.";
  return nextCursor === -1;
    }
