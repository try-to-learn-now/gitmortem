document.getElementById("load-btn").addEventListener("click", async () => {
    const url = document.getElementById("repo-url").value.trim();
    if (!url) return alert("Enter GitHub Repo URL!");

    const status = document.getElementById("status");
    const treeBox = document.getElementById("tree");
    const previewBox = document.getElementById("preview-box");

    previewBox.textContent = "Select a file...";
    treeBox.textContent = "";
    status.textContent = "⏳ Fetching Repo Structure...";

    try {
        const urlObj = new URL(url);
        const [ , owner, repo ] = urlObj.pathname.split("/");

        const response = await fetch(`/api/explore?owner=${owner}&repo=${repo}`);
        const text = await response.text();

        if (text.startsWith("Error:")) throw new Error(text);

        status.textContent = "✔️ Done!";
        treeBox.innerHTML = text;
    } catch (e) {
        status.textContent = "❌ Failed";
        treeBox.textContent = e.message;
    }

    document.querySelectorAll(".file-link").forEach(a =>
        a.addEventListener("click", async () => {
            const fileUrl = a.dataset.url;
            previewBox.textContent = "⏳ Loading...";

            const res = await fetch(fileUrl);
            const blob = await res.blob();

            if (blob.size > 5 * 1024 * 1024) {
                previewBox.textContent = "❌ File too large (Max 5MB preview)";
                return;
            }

            const text = await blob.text();
            previewBox.innerHTML = `<pre><code>${escapeHtml(text)}</code></pre>`;
            hljs.highlightAll();
        })
    );
});

function escapeHtml(unsafe) {
    return unsafe.replace(/[&<>"']/g, m =>
        ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m])
    );
}
