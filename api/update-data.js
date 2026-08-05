export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const expectedEditorKey = process.env.EDITOR_API_KEY;
    const requestEditorKey = req.headers["x-editor-key"];
    if (expectedEditorKey && requestEditorKey !== expectedEditorKey) {
        return res.status(401).json({
            error: "Unauthorized",
            statusCode: 401,
            hint: "updater 페이지의 편집 인증키가 Vercel 환경변수 EDITOR_API_KEY와 일치해야 합니다. 키를 다시 입력한 뒤 재시도하세요."
        });
    }

    const githubToken = (process.env.GITHUB_TOKEN || process.env.WBM || "").trim();
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

    const owner = (process.env.GITHUB_OWNER || "worldbookmap").trim();
    const repo = (process.env.GITHUB_REPO || "worldbookmap.github.io").trim();
    const branch = (process.env.GITHUB_BRANCH || "main").trim();
    const targetPath = (process.env.DATA_FILE_PATH || "data.json").trim();
    const encodedPath = targetPath.split("/").map(segment => encodeURIComponent(segment)).join("/");

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const commonHeaders = {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
    };

    async function fetchCurrentSha() {
        const getResponse = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, {
            method: "GET",
            headers: commonHeaders
        });

        if (getResponse.ok) {
            const currentFile = await getResponse.json();
            return { sha: currentFile.sha || undefined };
        }

        if (getResponse.status === 404) {
            return { sha: undefined };
        }

        const errorText = await getResponse.text();
        let detailMessage = errorText;
        try {
            const parsedError = JSON.parse(errorText);
            if (parsedError && parsedError.message) {
                detailMessage = parsedError.message;
            }
        } catch {
            // Keep original text if it is not JSON.
        }

        let hint = "Check token scope (contents:write), owner/repo, branch, and data file path.";
        if (getResponse.status === 401) {
            hint = "Bad credentials. Verify GITHUB_TOKEN/WBM value in Vercel and redeploy.";
        } else if (getResponse.status === 403) {
            hint = "Token lacks repository access. Ensure contents write permission for target repository.";
        } else if (getResponse.status === 422) {
            hint = "Invalid branch or request payload. Verify GITHUB_BRANCH and repository settings.";
        }

        const readError = new Error("Failed to read current file from GitHub");
        readError.statusCode = getResponse.status;
        readError.details = detailMessage;
        readError.hint = hint;
        throw readError;
    }

    let currentSha;
    try {
        const current = await fetchCurrentSha();
        currentSha = current.sha;
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || "Failed to read current file from GitHub",
            details: error.details || null,
            statusCode: error.statusCode || 500,
            context: {
                owner,
                repo,
                branch,
                targetPath
            },
            hint: error.hint || "Check token scope (contents:write), owner/repo, branch, and data file path."
        });
    }

    const normalizedJson = `${JSON.stringify(data, null, 2)}\n`;
    const encodedContent = Buffer.from(normalizedJson, "utf8").toString("base64");
    const commitMessage = typeof commitMessageInput === "string" && commitMessageInput.trim()
        ? commitMessageInput.trim()
        : "Update data.json via web editor";

    async function putDataWithSha(sha) {
        const payload = {
            message: commitMessage,
            content: encodedContent,
            branch
        };

        if (sha) {
            payload.sha = sha;
        }

        const putResponse = await fetch(apiBase, {
            method: "PUT",
            headers: commonHeaders,
            body: JSON.stringify(payload)
        });

        const putResult = await putResponse.json().catch(() => ({}));
        return { putResponse, putResult };
    }

    let { putResponse, putResult } = await putDataWithSha(currentSha);

    if (!putResponse.ok) {
        const detailMessage = String(putResult?.message || "").toLowerCase();
        const isShaConflict = putResponse.status === 409 || (putResponse.status === 422 && detailMessage.includes("sha"));

        if (isShaConflict) {
            try {
                const refreshed = await fetchCurrentSha();
                ({ putResponse, putResult } = await putDataWithSha(refreshed.sha));
            } catch (error) {
                return res.status(error.statusCode || 500).json({
                    error: error.message || "Failed to refresh file SHA",
                    details: error.details || null,
                    statusCode: error.statusCode || 500,
                    hint: error.hint || "Retry after reloading latest data.json."
                });
            }
        }
    }

    if (!putResponse.ok) {
        return res.status(putResponse.status).json({
            error: "Failed to update data.json",
            details: putResult,
            statusCode: putResponse.status,
            hint: putResponse.status === 409
                ? "Update conflict detected. Reload latest data.json and try again."
                : "Check repository permissions and branch protection rules."
        });
    }

    return res.status(200).json({
        ok: true,
        commitSha: putResult && putResult.commit ? putResult.commit.sha : null,
        commitUrl: putResult && putResult.commit ? putResult.commit.html_url : null
    });
}
