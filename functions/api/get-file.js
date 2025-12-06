// File: functions/api/get-file.js

export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const path = url.searchParams.get("path");

    if (!owner || !repo || !path) {
        return new Response("Missing params", { status: 400 });
    }

    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const token = env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    console.log("📄 File Fetch:", apiUrl);

    const res = await fetch(apiUrl, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github.v3.raw",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "GitMortem-Explorer"
        }
    });

    if (!res.ok) {
        const err = await res.text();
        return new Response(`GitHub Error: ${err}`, { status: res.status });
    }

    return new Response(res.body, {
        headers: {
            "Content-Type": res.headers.get("Content-Type") || "text/plain",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
