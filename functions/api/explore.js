// File Path: /functions/api/explore.js

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    
    // Aapke site ka domain (e.g., https://my-site.pages.dev)
    const origin = url.origin; 
    
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');

    if (!owner || !repo) {
        return new Response('Error: Owner and Repo required.', { status: 400 });
    }

    // --- 🧠 SMART TOKEN LOGIC ---
    // Owner ka naam clean karo (uppercase aur hyphens ko underscore banao)
    // Example: "try-to-learn-now" -> "TRY_TO_LEARN_NOW"
    const cleanOwner = owner.toUpperCase().replace(/-/g, '_');
    
    // Variable naam banao: "TOKEN_" + Owner Name
    const envVarName = `TOKEN_${cleanOwner}`;
    
    // Check karo Cloudflare mein yeh secret hai ya nahi, nahi toh DEFAULT use karo
    let token = env[envVarName] || env.TOKEN_DEFAULT;

    // Console logs (Cloudflare dashboard mein dikhenge debugging ke liye)
    console.log(`Repo: ${owner}/${repo}`);
    console.log(`Attempting to use secret: ${envVarName}`);
    console.log(`Token found? ${token ? "YES" : "NO (Using fallback if available)"}`);

    if (!token) {
        return new Response('Error: No token found for this user, and no TOKEN_DEFAULT set.', { status: 500 });
    }

    // GitHub API call
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Cloudflare-Worker-Explorer'
            }
        });

        if (!response.ok) {
            if (response.status === 404) return new Response(`Error: Repo not found or Private (Token for '${owner}' might be invalid).`, { status: 404 });
            return new Response(`GitHub API Error: ${response.statusText}`, { status: response.status });
        }

        const data = await response.json();
        
        // --- TREE GENERATION WITH FULL DOMAIN URLS ---
        let output = `${repo}/\n`;
        const tree = {};

        // Flat list se Nested object banana
        data.tree.forEach(file => {
            if (file.type !== 'blob') return; // Sirf files chahiye
            let current = tree;
            file.path.split('/').forEach((part, i, arr) => {
                if (!current[part]) current[part] = {};
                if (i === arr.length - 1) {
                    current[part].__isFile = true;
                    current[part].path = file.path;
                }
                current = current[part];
            });
        });

        // Text Output banana
        const buildTree = (node, prefix = '') => {
            let result = '';
            const entries = Object.keys(node);
            entries.forEach((entry, i) => {
                const isLast = i === entries.length - 1;
                const connector = isLast ? '└─' : '├─';
                const nextPrefix = prefix + (isLast ? '   ' : '│  ');

                if (node[entry].__isFile) {
                    // YAHAN HAI MAIN GAME: Full URL generate ho raha hai
                    // URL mein 'owner' aur 'repo' pass kar rahe hain taaki 'get-file' ko pata ho kiska token use karna hai
                    const fullUrl = `${origin}/api/get-file?owner=${owner}&repo=${repo}&path=${encodeURIComponent(node[entry].path)}`;
                    
                    result += `${prefix}${connector} ${entry}\n`;
                    result += `${prefix}${isLast ? '   ' : '│  '}└─ 🔗 ${fullUrl}\n`;
                } else {
                    result += `${prefix}${connector} ${entry}/\n`;
                    result += buildTree(node[entry], nextPrefix);
                }
            });
            return result;
        };

        output += buildTree(tree);
        return new Response(output, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    } catch (e) {
        return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
}

