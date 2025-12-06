export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");

    if (!owner || !repo)
        return new Response("Missing owner/repo", { status: 400 });

    const token = env[`TOKEN_${owner.toUpperCase()}`] || env.TOKEN_DEFAULT;

    try {
        const repoInfoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "GitMortem"
            }
        });

        const repoInfo = await repoInfoRes.json();
        if (!repoInfoRes.ok)
            return new Response(repoInfo.message, { status: repoInfoRes.status });

        const branch = repoInfo.default_branch || "main";

        const treeRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "GitMortem"
                }
            }
        );

        const tree = await treeRes.json();
        if (!treeRes.ok)
            return new Response(tree.message, { status: treeRes.status });

        const root = {};

        tree.tree.forEach(item => {
            const parts = item.path.split("/");
            let node = root;
            parts.forEach((p, i) => {
                node[p] ??= { __children: {}, __isFile: false, path: null };
                if (i === parts.length - 1 && item.type === "blob") {
                    node[p].__isFile = true;
                    node[p].path = item.path;
                }
                node = node[p].__children;
            });
        });

        const fileLine = (e, name, indent) =>
            `${indent}├── 📄 ${name}\n${indent}│   └─ 🔗 ${url.origin}/api/get-code?owner=${owner}&repo=${repo}&path=${encodeURIComponent(e.path)}\n`;

        const folderLine = (name, indent) =>
            `${indent}├── 📁 ${name}/\n`;

        const buildPanel = (fullPath, entry) => {
            let s = `📁 ${fullPath}/\n📋\n`;
            const names = Object.keys(entry.__children)
                .sort(a => entry.__children[a].__isFile ? 1 : -1);

            names.forEach(name => {
                const e = entry.__children[name];
                if (e.__isFile)
                    s += fileLine(e, name, "");
                else
                    s += folderLine(name, "");
            });

            return s + "\n";
        };

        const panels = [];

        const walk = (entry, fullPath) => {
            panels.push(buildPanel(fullPath, entry));
            for (const k in entry.__children) {
                const e = entry.__children[k];
                if (!e.__isFile)
                    walk(e, `${fullPath}/${k}`);
            }
        };

        walk({ __children: root }, repo);

        return new Response(
            panels.join("\n"),
            {
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Access-Control-Allow-Origin": "*"
                }
            }
        );

    } catch (err) {
        return new Response("Crash: " + err.message, { status: 500 });
    }
}
