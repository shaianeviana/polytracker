// PolyTracker — Vercel Serverless proxy for Polymarket Data API
// Usage: /api/data?wallet=0x...&type=activity&offset=0&limit=500

import type { VercelRequest, VercelResponse } from "@vercel/node";

const BASE = "https://data-api.polymarket.com";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const {
    wallet,
    type = "activity",
    offset = "0",
    limit = "500",
  } = req.query as Record<string, string>;

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    res.status(400).json({ error: "Invalid wallet address. Must be 0x followed by 40 hex chars." });
    return;
  }

  let url: string;
  if (type === "positions") {
    url = `${BASE}/positions?user=${wallet}&limit=${limit}&offset=${offset}&sizeThreshold=0`;
  } else if (type === "profile") {
    url = `${BASE}/profile?user=${wallet}`;
  } else {
    url = `${BASE}/activity?user=${wallet}&limit=${limit}&offset=${offset}`;
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Polymarket API returned ${response.status}` });
      return;
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
