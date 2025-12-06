export async function onRequest(context) {
    const { env } = context;
    const url = new URL(context.request.url);

    const owner = url.searchParams.get("owner");
    const path = url.searchParams.get("path");
    const repo = url.searchParams.get("repo");

    const cleanOwner = owner.toUpperCase().replace(/-/g, "_");
    const token = env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const res = await fetch(apiUrl, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github.v3.raw"
        }
    });

    return new Response(res.body, {
        headers: {
            "Content-Type": res.headers.get("Content-Type") || "text/plain",
            "Access-Control-Allow-Origin": "*"
        }
    });
}
