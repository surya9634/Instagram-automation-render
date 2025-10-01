import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.static("public"));
app.use(bodyParser.json());

// Temp storage for hotwords
const HOTWORDS_FILE = "./hotwords.json";
let hotwords = {};
if (fs.existsSync(HOTWORDS_FILE)) {
  hotwords = JSON.parse(fs.readFileSync(HOTWORDS_FILE));
}

// --------------------
// Instagram OAuth
// --------------------
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

    // Step 3: Subscribe YOUR Page to this IG account
    const subscribeRes = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.PAGE_ID}/subscribed_apps?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: ["messages","feed"]
        }),
      }
    );
    const subscribeData = await subscribeRes.json();

    // Redirect to frontend UI with IG username
    res.redirect(`/ui.html?username=${userData.username}&id=${userData.id}`);

  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

// --------------------
// Hotwords API
// --------------------
app.post("/save-hotword", (req, res) => {
  const { ig_user_id, post_id, hotword, reply } = req.body;
  if (!ig_user_id || !post_id || !hotword || !reply) return res.status(400).send("Missing fields");

  if (!hotwords[ig_user_id]) hotwords[ig_user_id] = [];
  hotwords[ig_user_id].push({ post_id, hotword, reply });

  fs.writeFileSync(HOTWORDS_FILE, JSON.stringify(hotwords, null, 2));
  res.json({ success: true });
});

// --------------------
// Get Hotwords (optional for UI)
app.get("/hotwords/:ig_user_id", (req,res)=>{
  const ig_user_id = req.params.ig_user_id;
  res.json(hotwords[ig_user_id] || []);
});

// --------------------
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
