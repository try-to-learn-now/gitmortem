// File: public/app.js

const repoInput = document.getElementById("repo-url");
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const treeBox = document.getElementById("tree");
const previewBox = document.getElementById("preview-box");
const copyTreeBtn = document.getElementById("copy-tree-btn");
const copyPreviewBtn = document.getElementById("copy-preview-btn");

// Load tree
loadBtn.addEventListener("click", async () => {
  const input = repoInput.value.trim();
  if (!input) {
    alert("Enter GitHub repo URL");
    return;
  }

  previewBox.textContent = "Select a file from tree above…";
  treeBox.textContent = "";
  statusEl.textContent = "⏳ Fetching tree...";

  try {
    const u = new URL(input);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Invalid GitHub URL");

    const owner = parts[0];
    const repo = parts[1];

    const res = await fetch(`/api/explore?owner=${owner}&repo=${repo}`);
    const text = await res.text();

    if (text.startsWith("Error:") || text.startsWith("RepoInfo Error") || text.startsWith("Tree Error")) {
      throw new Error(text);
    }

    statusEl.textContent = "✅ Done! You can copy the upper panel for AI.";
    treeBox.innerHTML = text;

    wireFolderPanels(); // add buttons / events
  } catch (err) {
    statusEl.textContent = "❌ Failed";
    treeBox.textContent = err.message;
  }
});

// Wire per-folder panel buttons
function wireFolderPanels() {
  document.querySelectorAll(".folder-panel").forEach(panel => {
    // If already wired, skip
    if (panel.dataset.wired === "1") return;
    panel.dataset.wired = "1";

    const titleEl = panel.querySelector(".folder-panel-title");
    if (!titleEl) return;

    // actions container
    const actions = document.createElement("span");
    actions.style.float = "right";
    actions.style.display = "flex";
    actions.style.gap = "4px";

    // Copy panel button
    const copyBtn = document.createElement("button");
    copyBtn.className = "icon-btn";
    copyBtn.title = "Copy this folder panel";
    copyBtn.textContent = "📋";

    copyBtn.addEventListener("click", () => {
      const text = panel.innerText;
      navigator.clipboard?.writeText(text).catch(() => {});
    });

    // Merge-folder-view button
    const mergeBtn = document.createElement("button");
    mergeBtn.className = "icon-btn merge";
    mergeBtn.title = "Load whole folder (all files) in preview";
    mergeBtn.textContent = "+";

    mergeBtn.addEventListener("click", () => {
      const fileSpans = panel.querySelectorAll(".file-link");
      if (!fileSpans.length) {
        previewBox.textContent = "This folder has no files.";
        return;
      }
      loadFolderIntoPreview(Array.from(fileSpans));
    });

    actions.appendChild(copyBtn);
    actions.appendChild(mergeBtn);
    titleEl.appendChild(actions);
  });
}

// Single-file click preview (delegated)
treeBox.addEventListener("click", async (e) => {
  const target = e.target;
  if (!target.classList.contains("file-link")) return;

  const fileUrl = target.dataset.url;
  const filePath = target.dataset.path || target.dataset.filename || "File";

  if (!fileUrl) return;

  previewBox.textContent = `⏳ Loading ${filePath} ...`;

  try {
    const res = await fetch(fileUrl);
    const blob = await res.blob();

    if (blob.size > 5 * 1024 * 1024) {
      previewBox.textContent = "❌ File too large to preview (max 5 MB)";
      return;
    }

    const text = await blob.text();
    const wrapped =
      `// File: ${filePath}\n\n` +
      text;

    previewBox.innerHTML = `<pre><code>${escapeHtml(wrapped)}</code></pre>`;
    if (window.hljs) hljs.highlightAll();
  } catch (err) {
    previewBox.textContent = "Error: " + err.message;
  }
});

// Folder merge view
async function loadFolderIntoPreview(fileSpans) {
  previewBox.textContent = "⏳ Loading folder (all files)...";

  let combined = "";

  for (const span of fileSpans) {
    const url = span.dataset.url;
    const path = span.dataset.path || span.dataset.filename || "File";
    if (!url) continue;

    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (blob.size > 5 * 1024 * 1024) {
        combined += `// File: ${path}\n// Skipped: too large (>5MB)\n\n// --------\n\n`;
        continue;
      }
      const code = await blob.text();
      combined += `// File: ${path}\n\n${code}\n\n// --------\n\n`;
    } catch (e) {
      combined += `// File: ${path}\n// Error loading: ${e.message}\n\n// --------\n\n`;
    }
  }

  if (!combined) {
    previewBox.textContent = "No readable files in this folder.";
    return;
  }

  previewBox.innerHTML = `<pre><code>${escapeHtml(combined)}</code></pre>`;
  if (window.hljs) hljs.highlightAll();
}

// Global copy buttons
copyTreeBtn.addEventListener("click", () => {
  const text = treeBox.innerText || "";
  navigator.clipboard?.writeText(text).catch(() => {});
});

copyPreviewBtn.addEventListener("click", () => {
  const text = previewBox.innerText || "";
  navigator.clipboard?.writeText(text).catch(() => {});
});

// util
function escapeHtml(txt) {
  return txt.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c])
  );
}
