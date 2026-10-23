// Storage: Upstash Redis (Vercel Marketplace). Env vars are set automatically when you connect it:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (or KV_REST_API_URL / KV_REST_API_TOKEN)
// Optional: DISCORD_WEBHOOK_URL still logs every vote to Discord.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = async (commands) => {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error(`Redis returned ${r.status}`);
  return r.json(); // [{result}, ...]
};

const ID = /^[\w-]{1,40}$/;
const safe = (value) => value.replace(/([\\`*_{}[\]()<>@])/g, "\\$1");

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "Vote storage is not configured" });
  }

  // GET /api/vote?poll=p1 -> { tally: { contenderId: { c, n } } }
  if (req.method === "GET") {
    const poll = String(req.query.poll || "");
    if (!ID.test(poll)) return res.status(400).json({ error: "Invalid poll" });
    try {
      const [{ result }] = await redis([["HGETALL", `hcr:${poll}:tally`]]);
      const tally = {};
      for (let i = 0; i < (result || []).length; i += 2) {
        const [id, kind] = result[i].split(":");
        (tally[id] ||= { c: 0, n: 0 })[kind] = Number(result[i + 1]);
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ tally });
    } catch (error) {
      console.error("Tally read failed:", error.message);
      return res.status(502).json({ error: "Could not load points" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { contender, contenderId, verdict, poll, pollId, voterId } = req.body || {};

  if (
    typeof contender !== "string" || contender.length < 1 || contender.length > 100 ||
    typeof contenderId !== "string" || !ID.test(contenderId) ||
    !["Chad", "Not Chad"].includes(verdict) ||
    typeof poll !== "string" || poll.length > 500 ||
    typeof pollId !== "string" || !ID.test(pollId) ||
    typeof voterId !== "string" || voterId.length < 1 || voterId.length > 100 ||
    !/^[\w-]+$/.test(voterId)
  ) {
    return res.status(400).json({ error: "Invalid vote data" });
  }

  const kind = verdict === "Chad" ? "c" : "n";
  const tallyKey = `hcr:${pollId}:tally`;

  try {
    // One vote per voter per contender per poll (SET NX).
    const [{ result: first }] = await redis([
      ["SET", `hcr:${pollId}:v:${voterId}:${contenderId}`, kind, "NX"]
    ]);
    if (!first) return res.status(409).json({ error: "Already voted" });

    await redis([["HINCRBY", tallyKey, `${contenderId}:${kind}`, 1]]);
    const [{ result: c }, { result: n }] = await redis([
      ["HGET", tallyKey, `${contenderId}:c`],
      ["HGET", tallyKey, `${contenderId}:n`]
    ]);
    const tally = { c: Number(c || 0), n: Number(n || 0) };

    // Optional Discord log; a failure here never fails the vote.
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "HCR Votes",
          allowed_mentions: { parse: [] },
          embeds: [{
            title: "New vote",
            color: kind === "c" ? 5099696 : 16739199,
            fields: [
              { name: "Contender", value: safe(contender) },
              { name: "Verdict", value: verdict },
              { name: "Points now", value: String(tally.c - tally.n) },
              { name: "Voter ID", value: safe(voterId.slice(0, 8)) }
            ],
            timestamp: new Date().toISOString()
          }]
        })
      }).catch((e) => console.error("Discord log failed:", e.message));
    }

    return res.status(200).json({ success: true, tally });
  } catch (error) {
    console.error("Vote failed:", error.message);
    return res.status(502).json({ error: "Could not record vote" });
  }
}
