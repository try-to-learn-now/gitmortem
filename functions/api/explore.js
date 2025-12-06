// File Path: /functions/api/explore.js

export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);
    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");

    if (!owner || !repo)
        return new Response("Error: Missing owner/repo", { status: 400 });

    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const envVar = `TOKEN_${cleanOwner}`;
    const token = env[envVar] || env.TOKEN_DEFAULT;

    if (!token) return new Response("Error: No token found!", { status: 500 });

    const repoInfo = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });

    if (!repoInfo.ok)
        return new Response(`Error: Repo not accessible`, { status: repoInfo.status });

    const { default_branch } = await repoInfo.json();

    const apiUrl =
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${default_branch}?recursive=1`;

    const response = await fetch(apiUrl, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await response.json();

    let html = `<strong>${repo}/</strong>\n`;

    function add(entry, prefix = "") {
        let line;

        if (entry.type === "tree") {
            line = `<span class='folder'>${prefix}📁 ${entry.path}</span>\n`;
        } else {
            const fileUrl =
                `${url.origin}/api/get-file?owner=${owner}&repo=${repo}&path=${encodeURIComponent(entry.path)}`;
            line =
                `${prefix}📄 <span class='file-link' data-url="${fileUrl}">${entry.path}</span>\n`;
        }
        html += line;
    }

    data.tree.forEach(file => add(file));

    return new Response(html, { headers: { "Content-Type": "text/html" } });
}
