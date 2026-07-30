export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const expectedEditorKey = process.env.EDITOR_API_KEY;
    const requestEditorKey = req.headers["x-editor-key"];
    if (expectedEditorKey && requestEditorKey !== expectedEditorKey) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const githubToken = process.env.GITHUB_TOKEN || process.env.WBM;
    if (!githubToken) {
        return res.status(500).json({ error: "GITHUB_TOKEN or WBM is not configured" });
    }

    let body = req.body;
    if (typeof body === "string") {
        try {
            body = JSON.parse(body);
        } catch {
            return res.status(400).json({ error: "Invalid JSON body" });
        }
    }

    const data = body && body.data;
    const commitMessageInput = body && body.commitMessage;
    if (!Array.isArray(data)) {
        return res.status(400).json({ error: "data must be an array" });
    }

    const owner = process.env.GITHUB_OWNER || "worldbookmap";
    const repo = process.env.GITHUB_REPO || "worldbookmap.github.io";
    const branch = process.env.GITHUB_BRANCH || "main";
    const targetPath = process.env.DATA_FILE_PATH || "data.json";
    const encodedPath = targetPath.split("/").map(segment => encodeURIComponent(segment)).join("/");

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const commonHeaders = {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
    };

    let currentSha;
    const getResponse = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, {
        method: "GET",
        headers: commonHeaders
    });

    if (getResponse.ok) {
        const currentFile = await getResponse.json();
        currentSha = currentFile.sha;
    } else if (getResponse.status !== 404) {
        const errorText = await getResponse.text();
        return res.status(getResponse.status).json({
            error: "Failed to read current file from GitHub",
            details: errorText
        });
    }

    const normalizedJson = `${JSON.stringify(data, null, 2)}\n`;
    const encodedContent = Buffer.from(normalizedJson, "utf8").toString("base64");
    const commitMessage = typeof commitMessageInput === "string" && commitMessageInput.trim()
        ? commitMessageInput.trim()
        : "Update data.json via web editor";

    const payload = {
        message: commitMessage,
        content: encodedContent,
        branch
    };

    if (currentSha) {
        payload.sha = currentSha;
    }

    const putResponse = await fetch(apiBase, {
        method: "PUT",
        headers: commonHeaders,
        body: JSON.stringify(payload)
    });

    const putResult = await putResponse.json().catch(() => ({}));
    if (!putResponse.ok) {
        return res.status(putResponse.status).json({
            error: "Failed to update data.json",
            details: putResult
        });
    }

    return res.status(200).json({
        ok: true,
        commitSha: putResult && putResult.commit ? putResult.commit.sha : null,
        commitUrl: putResult && putResult.commit ? putResult.commit.html_url : null
    });
}
