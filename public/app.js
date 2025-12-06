// Generate tree
document.getElementById("load-btn").addEventListener("click", async () => {
    const input = document.getElementById("repo-url").value.trim();
    if (!input) return alert("Enter GitHub Repo URL!");

    const status = document.getElementById("status");
    const treeBox = document.getElementById("tree");
    const previewBox = document.getElementById("preview-box");

    previewBox.textContent = "Select a file from tree above…";
    treeBox.textContent = "";
    status.textContent = "⏳ Fetching tree...";

    try {
        const url = new URL(input);
        const [, owner, repo] = url.pathname.split("/");

        if (!owner || !repo) throw new Error("Invalid GitHub URL. Format: https://github.com/owner/repo");

        const res = await fetch(`/api/explore?owner=${owner}&repo=${repo}`);
        const text = await res.text();

        if (text.startsWith("Error:")) throw new Error(text);

        status.textContent = "✔️ Done! You can copy the upper panel for AI.";
        treeBox.innerHTML = text; // contains spans + links

    } catch (err) {
        status.textContent = "❌ Failed";
        treeBox.textContent = err.message;
    }
});

// Click on file name → show preview in lower panel
document.getElementById("tree").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("file-link")) return;

    const previewBox = document.getElementById("preview-box");
    const fileUrl = e.target.dataset.url;
    if (!fileUrl) return;

    previewBox.textContent = "⏳ Loading...";

    try {
        const res = await fetch(fileUrl);

        if (!res.ok) {
            const err = await res.text();
            previewBox.textContent = `GitMortem Proxy Error: ${err}`;
            return;
        }

        const text = await res.text(); // get-code returns plain text

        const name = e.target.dataset.filename || "";
        const ext = name.split(".").pop().toLowerCase();

        let langClass = "";
        if (["js","jsx","mjs","cjs"].includes(ext)) langClass = "language-javascript";
        else if (["ts","tsx"].includes(ext)) langClass = "language-typescript";
        else if (["json"].includes(ext)) langClass = "language-json";
        else if (["py"].includes(ext)) langClass = "language-python";
        else if (["java"].includes(ext)) langClass = "language-java";
        else if (["c","h"].includes(ext)) langClass = "language-c";
        else if (["cpp","cc","hpp"].includes(ext)) langClass = "language-cpp";
        else if (["md"].includes(ext)) langClass = "language-markdown";

        previewBox.innerHTML = `<pre><code class="${langClass}">${escapeHtml(text)}</code></pre>`;
        if (window.hljs) hljs.highlightAll();
    } catch (err) {
        previewBox.textContent = `Preview error: ${err.message}`;
    }
});

// Icon-only copy buttons (both panels)
document.querySelectorAll(".copy-icon-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        const targetId = btn.dataset.target;
        const targetEl = document.getElementById(targetId);
        if (!targetEl) return;

        const text = targetEl.innerText || targetEl.textContent || "";
        try {
            await navigator.clipboard.writeText(text);
            showCopiedToast(targetId);
        } catch (e) {
            console.error("Copy failed:", e);
        }
    });
});

function showCopiedToast(targetId) {
    let spanId = targetId === "tree" ? "tree-copied" : "preview-copied";
    const el = document.getElementById(spanId);
    if (!el) return;
    el.textContent = "Copied!";
    setTimeout(() => { el.textContent = ""; }, 1200);
}

function escapeHtml(txt) {
    return txt.replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c])
    );
}
