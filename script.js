import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Step 1: Exchange code for short-lived IG token
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.APP_ID,
        client_secret: process.env.APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: process.env.REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.status(400).json(tokenData);

    const shortLivedToken = tokenData.access_token;

    // Step 2: Exchange for long-lived token
    const longTokenRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.APP_SECRET}&access_token=${shortLivedToken}`
    );
    const longTokenData = await longTokenRes.json();
    const userToken = longTokenData.access_token;

    // Step 3: Get FB Pages connected to this IG account
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData.data || !pagesData.data.length) {
      return res.status(400).json({ error: "No Facebook Pages found linked to this account" });
    }

    // Take first Page
    const page = pagesData.data[0];
    const pageAccessToken = page.access_token;

    // Step 4: Subscribe the Page for IG DMs
    const subscribeRes = await fetch(
      `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?access_token=${pageAccessToken}`,
      {
        method: "POST",
      }
    );
    const subscribeData = await subscribeRes.json();

    res.json({
      message: "✅ Instagram account connected to your Page successfully!",
      instagramUser: tokenData,
      page: page,
      subscription: subscribeData,
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
