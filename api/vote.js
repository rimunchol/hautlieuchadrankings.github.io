
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;

  if (!webhook) {
    return res.status(500).json({ error: "Voting is not configured" });
  }

  const { contender, verdict, poll, voterId } = req.body || {};

  if (
    typeof contender !== "string" ||
    contender.length < 1 ||
    contender.length > 100 ||
    !["Chad", "Not Chad"].includes(verdict) ||
    typeof poll !== "string" ||
    poll.length > 500 ||
    typeof voterId !== "string" ||
    voterId.length > 100
  ) {
    return res.status(400).json({ error: "Invalid vote data" });
  }

  // Prevent Discord message formatting from being abused.
  const safe = (value) => value.replace(/([\\`*_{}[\]()<>@])/g, "\\$1");

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "HCR Votes",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: "New vote",
          color: verdict === "Chad" ? 5099696 : 16739199,
          fields: [
            { name: "Contender", value: safe(contender) },
            { name: "Verdict", value: verdict },
            { name: "Poll", value: safe(poll || "Community vote") },
            { name: "Voter ID", value: safe(voterId.slice(0, 8)) }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    });

    if (!response.ok) {
      console.error("Discord webhook returned status:", response.status);
      return res.status(502).json({ error: "Could not deliver vote" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Vote delivery failed:", error.message);
    return res.status(502).json({ error: "Could not deliver vote" });
  }
}
