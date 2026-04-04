// Vercel Serverless — proxies Polymarket Data API for any wallet
// Usage: /api/data?wallet=0x...&type=activity&offset=0&limit=500

const BASE = "https://data-api.polymarket.com";

export default async function handler(req, res) {
  const { wallet, type = "activity", offset = "0", limit = "500" } = req.query;

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: "Invalid wallet address. Must be 0x followed by 40 hex chars." });
  }

  let url;
  if (type === "positions") {
    url = `${BASE}/positions?user=${wallet}&limit=${limit}&offset=${offset}&sizeThreshold=0`;
  } else if (type === "profile") {
    url = `${BASE}/profile?user=${wallet}`;
  } else {
    url = `${BASE}/activity?user=${wallet}&limit=${limit}&offset=${offset}`;
  }

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Polymarket API returned ${response.status}` });
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
