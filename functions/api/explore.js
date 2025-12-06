// File: functions/api/explore.js

export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");

    if (!owner || !repo) {
        return new Response("Error: Missing owner/repo", { status: 400 });
    }

    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const envVar = `TOKEN_${cleanOwner}`;
    const token = env[envVar] || env.TOKEN_DEFAULT;

    console.log("========== GITMORTEM ==========");
    console.log("Owner:", owner);
    console.log("Repo:", repo);
    console.log("Token Found:", token ? "YES" : "NO");

    try {
        const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const repoInfoRes = await fetch(repoInfoUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        const repoInfo = await repoInfoRes.json();
        if (!repoInfoRes.ok) {
            return new Response(`RepoInfo Error: ${repoInfo.message}`, {
                status: repoInfoRes.status
            });
        }

        const branch = repoInfo.default_branch || "main";

        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const treeRes = await fetch(treeUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "GitMortem-Explorer"
            }
        });

        const treeJson = await treeRes.json();
        if (!treeRes.ok) {
            return new Response(`Tree Error: ${treeJson.message}`, {
                status: treeRes.status
            });
        }

        const root = {};

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

                if (idx === parts.length - 1 && item.type === "blob") {
                    node[part].__isFile = true;
                    node[part].path = item.path;
                }

                node = node[part].__children;
            });
        });

        const renderFolderChildren = (folderEntry) => {
            const children = folderEntry.__children || {};
            const names = Object.keys(children).sort();

            return names.map(name => {
                const entry = children[name];
                if (entry.__isFile) {
                    const fileUrl = `${url.origin}/api/get-code?owner=${owner}&repo=${repo}&path=${encodeURIComponent(entry.path)}`;
                    return `├── 📄 <span class="file-link" data-url="${fileUrl}" data-filename="${name}">${name}</span>\n`;
                } else {
                    return `├── 📁 ${name}/\n`;
                }
            }).join("") || "(empty folder)\n";
        };

        const folderEntries = [];

        const walk = (entry, fullPath) => {
            folderEntries.push({ fullPath, entry });
            for (const name in entry.__children) {
                const child = entry.__children[name];
                if (!child.__isFile) {
                    walk(child, `${fullPath}/${name}`);
                }
            }
        };

        walk({ __children: root }, repo);

        let html = "";

        folderEntries.forEach(({ fullPath, entry }) => {
            html += `
<div class="folder-panel">
  <div class="folder-panel-header">
    <span class="folder-panel-title">📁 ${fullPath}/</span>
    <button class="folder-panel-copy-btn" data-copy="${fullPath}/">📋</button>
  </div>
  <pre>${renderFolderChildren(entry)}</pre>
</div>\n\n`;
        });

        return new Response(html, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Access-Control-Allow-Origin": "*"
            }
        });

    } catch (e) {
        console.log("CRASH=>", e);
        return new Response(`Crash: ${e.message}`, { status: 500 });
    }
}
