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
        const repoInfoRes = await fetch(repoInfoUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        const repoInfo = await repoInfoRes.json();

        if (!repoInfoRes.ok) {
            return new Response(
                `RepoInfo Error: ${repoInfo.message}`,
                { status: repoInfoRes.status }
            );
        }

        const branch = repoInfo.default_branch || "main";

        // STEP-2 → Tree fetch (recursive)
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const treeRes = await fetch(treeUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        const treeJson = await treeRes.json();

        if (!treeRes.ok) {
            return new Response(
                `Tree Error: ${treeJson.message}`,
                { status: treeRes.status }
            );
        }

        // ---- Build nested tree structure ----
        const root = {}; // virtual root

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

        // ---- Helper: render ONLY direct children of a folder (no recursion) ----
        const renderFolderChildren = (folderEntry) => {
            const children = folderEntry.__children || {};
            const names = Object.keys(children);

            // Folders first, then files
            names.sort((a, b) => {
                const aIsFile = children[a].__isFile;
                const bIsFile = children[b].__isFile;
                if (aIsFile !== bIsFile) return aIsFile - bIsFile;
                return a.localeCompare(b);
            });

            let out = "";
            names.forEach((name, index) => {
                const entry = children[name];
                const isLast = index === names.length - 1;
                const connector = isLast ? "└──" : "├──";

                if (entry.__isFile) {
                    const fullUrl =
                        `${url.origin}/api/get-code?owner=${owner}&repo=${repo}&path=${encodeURIComponent(entry.path)}`;

                    out += `${connector} 📄 <span class="file-link" data-url="${fullUrl}" data-filename="${name}">${name}</span>\n`;
                    out += `    └─ 🔗 ${fullUrl}\n`;
                } else {
                    // just show folder name, no recursion inside this panel
                    out += `${connector} 📁 ${name}/\n`;
                }
            });

            if (!out) {
                out = "(empty folder)\n";
            }

            return out;
        };

        // ---- Collect ALL folders (with full path) ----
        const folderEntries = [];

        const walkFolders = (map, currentPath) => {
            const names = Object.keys(map);
            names.forEach(name => {
                const entry = map[name];
                if (!entry.__isFile) {
                    const fullPath = currentPath ? `${currentPath}/${name}` : name;
                    folderEntries.push({ fullPath, entry });
                    // still walk deeper to discover subfolders (for their own panels)
                    walkFolders(entry.__children || {}, fullPath);
                }
            });
        };

        // Root-level files (no folder)
        const allNames = Object.keys(root);
        const rootFileNames = allNames.filter(n => root[n].__isFile);
        const rootFolderNames = allNames.filter(n => !root[n].__isFile);

        // Collect all folder nodes (including nested)
        walkFolders(root, "");

        // ---- Build HTML with flat panels ----
        let html = `${repo}/\n\n`;

        // Root files panel (if any)
        if (rootFileNames.length) {
            const fakeRootEntry = { __children: {}, __isFile: false };
            rootFileNames.forEach(name => {
                fakeRootEntry.__children[name] = root[name];
            });

            html += `<div class="folder-panel">`;
            html += `<div class="folder-panel-title">📄 Root files</div>`;
            html += `<pre>${renderFolderChildren(fakeRootEntry)}</pre>`;
            html += `</div>\n\n`;
        }

        // Panels for every folder path (no nested tree inside)
        // sort by fullPath so panel order stable
        folderEntries.sort((a, b) => a.fullPath.localeCompare(b.fullPath));

        folderEntries.forEach(({ fullPath, entry }) => {
            html += `<div class="folder-panel">`;
            html += `<div class="folder-panel-title">📁 ${fullPath}/</div>`;
            html += `<pre>${renderFolderChildren(entry)}</pre>`;
            html += `</div>\n\n`;
        });

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
