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

    console.log("========== GITMORTEM ==========");
    console.log("Owner:", owner);
    console.log("Repo:", repo);
    console.log("Token Found:", token ? "YES" : "NO");
    console.log("Env Var Used:", envVar);

    try {
        // STEP-1 → Repo Info
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

        // STEP-2 → Tree fetch (recursive)
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
        console.log("Tree JSON (truncated view):", {
            sha: treeJson.sha,
            truncated: treeJson.truncated,
            count: treeJson.tree ? treeJson.tree.length : 0
        });

        if (!treeRes.ok) {
            return new Response(
                `Tree Error: ${treeJson.message}`,
                { status: treeRes.status }
            );
        }

        // ---- Build nested tree structure ----
        const root = {};

        // root is object: { name: { __children, __isFile, path } }
        (treeJson.tree || []).forEach(item => {
            const parts = item.path.split("/");
            let node = root;

            parts.forEach((part, idx) => {
                if (!node[part]) {
                    node[part] = {
                        __children: {},
                        __isFile: false,
                        path: null
                    };
                }
                const isLast = idx === parts.length - 1;

                if (isLast && item.type === "blob") {
                    node[part].__isFile = true;
                    node[part].path = item.path;
                }

                node = node[part].__children;
            });
        });

        // ---- Helper to render ASCII tree with links ----
        const buildTree = (node, prefix = "") => {
            let result = "";
            const names = Object.keys(node);

            // Folders first, then files, alphabetical
            names.sort((a, b) => {
                const aIsFile = node[a].__isFile;
                const bIsFile = node[b].__isFile;
                if (aIsFile !== bIsFile) return aIsFile - bIsFile; // false (folder) first
                return a.localeCompare(b);
            });

            names.forEach((name, index) => {
                const entry = node[name];
                const isLast = index === names.length - 1;
                const connector = isLast ? "└──" : "├──";
                const childPrefix = prefix + (isLast ? "    " : "│   ");

                if (entry.__isFile) {
                    const fullUrl = `${url.origin}/api/get-code?owner=${owner}&repo=${repo}&path=${encodeURIComponent(entry.path)}`;

                    // File line (clickable name for preview)
                    result += `${prefix}${connector} 📄 <span class="file-link" data-url="${fullUrl}" data-filename="${name}">${name}</span>\n`;

                    // Link line (for AI / copy)
                    result += `${childPrefix}└─ 🔗 ${fullUrl}\n`;
                } else {
                    // Folder line
                    result += `${prefix}${connector} 📁 ${name}/\n`;
                    result += buildTree(entry.__children, childPrefix);
                }
            });

            return result;
        };

        let html = `${repo}/\n`;
        html += buildTree(root, "");

        console.log("========== END GITMORTEM ==========");

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
