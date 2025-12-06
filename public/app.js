document.getElementById("load-btn").addEventListener("click", async () => {
    const input = document.getElementById("repo-url").value.trim();
    if (!input) return alert("Enter GitHub Repo URL!");

    const status = document.getElementById("status");
    const treeBox = document.getElementById("tree");
    const previewBox = document.getElementById("preview-box");

    previewBox.textContent = "Select a file...";
    treeBox.textContent = "";
    status.textContent = "⏳ Fetching tree...";

    try {
        const url = new URL(input);
        const [ , owner, repo ] = url.pathname.split("/");

        const res = await fetch(`/api/explore?owner=${owner}&repo=${repo}`);
        const text = await res.text();

        if (text.startsWith("Error:")) throw new Error(text);

        status.textContent = "✔️ Done!";
        treeBox.innerHTML = text;
    } catch (err) {
        status.textContent = "❌ Failed";
        treeBox.textContent = err.message;
    }
});

// 🔥 Event Delegation (Handles dynamic elements also!)
document.getElementById("tree").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("file-link")) return;

    const previewBox = document.getElementById("preview-box");

    const fileUrl = e.target.dataset.url;
    if (!fileUrl) return;

    previewBox.textContent = "⏳ Loading...";

    const res = await fetch(fileUrl);
    const blob = await res.blob();

    if (blob.size > 5 * 1024 * 1024) {
        previewBox.textContent = "❌ File too large to preview (max 5MB)";
        return;
    }

    const text = await blob.text();
    previewBox.innerHTML = `<pre><code>${escapeHtml(text)}</code></pre>`;
    hljs.highlightAll();
});

function escapeHtml(txt) {
    return txt.replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c])
    );
}
