export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const title = String((req.query && req.query.title) || "").trim();
    const author = String((req.query && req.query.author) || "").trim();

    if (!title) {
        return res.status(400).json({ error: "title query is required" });
    }

    const kakaoKey = String(process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || "").trim();
    if (!kakaoKey) {
        return res.status(500).json({ error: "KAKAO_REST_API_KEY is not configured" });
    }

    async function searchKakao(query, target) {
        const endpoint = new URL("https://dapi.kakao.com/v3/search/book");
        endpoint.searchParams.set("query", query);
        endpoint.searchParams.set("size", "1");
        if (target) {
            endpoint.searchParams.set("target", target);
        }

        const response = await fetch(endpoint.toString(), {
            method: "GET",
            headers: {
                Authorization: "KakaoAK " + kakaoKey
            }
        });

        if (!response.ok) {
            const details = await response.text().catch(() => "");
            throw new Error("Kakao Book API request failed: HTTP " + response.status + " " + details);
        }

        return response.json();
    }

    try {
        const searchPlans = [
            { query: title, target: "title" },
            { query: author ? (title + " " + author) : title, target: "" },
            { query: title, target: "" }
        ];

        let thumbnail = "";

        for (const plan of searchPlans) {
            const payload = await searchKakao(plan.query, plan.target);
            thumbnail = payload?.documents?.[0]?.thumbnail || "";
            if (thumbnail) break;
        }

        return res.status(200).json({
            ok: true,
            thumbnail: thumbnail ? thumbnail.replace(/^http:/, "https:") : ""
        });
    } catch (error) {
        return res.status(500).json({
            error: "Unexpected error",
            details: error && error.message ? error.message : String(error)
        });
    }
}