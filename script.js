import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// Instagram callback
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

    // Step 2: Exchange IG token for long-lived token
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.APP_SECRET}&access_token=${shortLivedToken}`
    );
    const longData = await longRes.json();
    const igLongLivedToken = longData.access_token;

    // Step 3: Get FB Pages the user manages (requires pages_show_list)
    const fbRes = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${igLongLivedToken}`
    );
    const fbPages = await fbRes.json();

    const page = fbPages.data?.find(p => p.id === process.env.PLATFORM_PAGE_ID);
    if (!page) {
      return res.status(400).send("User does not manage the required FB Page.");
    }

    const pageAccessToken = page.access_token;

    // Step 4: Check if IG is connected to the Page
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.PLATFORM_PAGE_ID}?fields=connected_instagram_account&access_token=${pageAccessToken}`
    );
    const igData = await igRes.json();

    if (!igData.connected_instagram_account) {
      return res
        .status(400)
        .send("IG not connected to Page. Please approve Instagram ↔ Page connection.");
    }

    res.json({
      message: "✅ Instagram connected successfully!",
      instagramAccount: igData.connected_instagram_account,
      pageId: process.env.PLATFORM_PAGE_ID,
      pageAccessToken
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
