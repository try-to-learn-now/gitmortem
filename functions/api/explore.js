// File: functions/api/explore.js

export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");

    if (!owner || !repo) {
        return new Response("Error: Missing owner/repo", { status: 400 });
    }

    // Token Select Logic
    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const envVar = `TOKEN_${cleanOwner}`;
    const token = env[envVar] || env.TOKEN_DEFAULT;

    console.log("========== GITMORTEM DEBUG ==========");
    console.log("Owner:", owner);
    console.log("Repo:", repo);
    console.log("Token Found:", token ? "YES" : "NO");
    console.log("Env Var Used:", envVar);

    try {
        // STEP-1 → Repo Info Check
        const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        console.log("RepoInfo API:", repoInfoUrl);

        const repoInfoRes = await fetch(repoInfoUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        console.log("RepoInfo Status:", repoInfoRes.status);
        const repoInfo = await repoInfoRes.json();
        console.log("RepoInfo JSON:", repoInfo);

        if (!repoInfoRes.ok) {
            return new Response(
                `RepoInfo Error: ${repoInfo.message}`,
                { status: repoInfoRes.status }
            );
        }

        const branch = repoInfo.default_branch || "main";
        console.log("Default Branch:", branch);

        // STEP-2 → Tree fetch
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        console.log("Tree API:", treeUrl);

        const treeRes = await fetch(treeUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        console.log("Tree Status:", treeRes.status);
        const treeJson = await treeRes.json();
        console.log("Tree JSON:", treeJson);

        if (!treeRes.ok) {
            return new Response(
                `Tree Error: ${treeJson.message}`,
                { status: treeRes.status }
            );
        }

        let html = `${repo}/\n`;

        treeJson.tree.forEach(item => {
            if (item.type === "tree") {
                html += `📁 ${item.path}\n`;
            } else {
                const fileUrl =
                    `${url.origin}/api/get-file?owner=${owner}&repo=${repo}&path=${encodeURIComponent(item.path)}`;
                html += `📄 <span class="file-link" data-url="${fileUrl}">${item.path}</span>\n`;
            }
        });

        console.log("========== END DEBUG ==========");

        return new Response(html, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
            }
        });

    } catch (e) {
        console.log("CRASH:", e);
        return new Response(`Server Crash: ${e.message}`, { status: 500 });
    }
}
