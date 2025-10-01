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

    const igUserToken = tokenData.access_token;

    // Step 2: Get IG user info
    const userRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${igUserToken}`
    );
    const userData = await userRes.json();

    // Step 3: Subscribe YOUR FB Page to receive this IG account’s DMs
    // ⚠️ Use your permanent PAGE_ACCESS_TOKEN from .env
    const subscribeRes = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.PAGE_ID}/subscribed_apps?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: ["messages", "feed", "comments"]
        }),
      }
    );
    const subscribeData = await subscribeRes.json();

    res.json({
      message: "✅ Instagram account connected to your Page successfully!",
      instagramUser: userData,
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
