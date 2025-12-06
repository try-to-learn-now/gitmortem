// File: functions/api/get-code.js

export async function onRequest(context) {
    const { env, request } = context;
    const url = new URL(request.url);

    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const path = url.searchParams.get("path");

    if (!owner || !repo || !path) {
        return new Response("Missing owner/repo/path", { status: 400 });
    }

    // 🧠 Token select logic (same as explore.js)
    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const token = env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT;

    if (!token) {
        return new Response("Server config error: No token found", { status: 500 });
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    console.log("📄 get-code →", apiUrl);

    try {
        const res = await fetch(apiUrl, {
            headers: {
                // PAT for private + better rate limit
                "Authorization": `Bearer ${token}`,
                // Important: normal browser type UA, so GitHub always happy
                "User-Agent": "Mozilla/5.0 (GitMortem-AI-Proxy)",
                // We want RAW content, not JSON metadata
                "Accept": "application/vnd.github.v3.raw"
            }
        });

        if (!res.ok) {
            const err = await res.text().catch(() => "");
            console.log("❌ GitHub get-code Error:", res.status, err);
            return new Response(
                `GitHub Error (${res.status}): ${err || res.statusText}`,
                { status: res.status }
            );
        }

        // FORCE text mode so browser + AI treat this as plain readable code
        const text = await res.text();

        return new Response(text, {
            headers: {
                // Always plain text – like raw.githubusercontent.com
                "Content-Type": "text/plain; charset=utf-8",
                // Allow any AI / browser to read
                "Access-Control-Allow-Origin": "*"
            }
        });

    } catch (e) {
        console.log("💥 get-code Crash:", e);
        return new Response(`Proxy Crash: ${e.message}`, { status: 500 });
    }
}
