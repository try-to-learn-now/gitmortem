// File: functions/api/get-code.js

export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const path = url.searchParams.get("path");

    if (!owner || !repo || !path) {
        return new Response("Missing owner/repo/path", { status: 400 });
    }

    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const token = env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const res = await fetch(apiUrl, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "User-Agent": "GitMortem-Explorer",
            "Accept": "application/vnd.github.v3.raw"
        }
    });

    if (!res.ok) {
        const err = await res.text();
        return new Response(`GitHub Error: ${err}`, { status: res.status });
    }

    // Convert ALWAYS to raw text
    const text = await res.text();

    return new Response(text, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
