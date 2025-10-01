import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(express.static("public"));
app.use(bodyParser.json());

// In-memory hotword storage
const hotwords = {};

// ---------------- OAuth callback ----------------
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send("Missing code");

  try {
    // Exchange code for IG access token
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
    if (tokenData.error) return res.json(tokenData);

    const igUserToken = tokenData.access_token;

    // Get IG user info
    const userRes = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${igUserToken}`);
    const userData = await userRes.json();

    // Redirect to simple UI for hotwords
    res.redirect(`/ui.html?username=${userData.username}&id=${userData.id}`);
  } catch (err) {
    console.error(err);
    res.send("Auth failed");
  }
});

// ---------------- Hotword API ----------------
app.post("/save-hotword", (req, res) => {
  const { ig_user_id, post_id, hotword, reply } = req.body;
  if (!hotwords[ig_user_id]) hotwords[ig_user_id] = [];
  hotwords[ig_user_id].push({ post_id, hotword, reply });
  res.json({ success: true });
});

// ---------------- Webhook ----------------
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (!body.entry) return res.sendStatus(200);

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (change.field === "feed") {
        const { text, from, media_id } = change.value;
        for (const ig_user_id in hotwords) {
          for (const mapping of hotwords[ig_user_id]) {
            if (mapping.post_id === media_id && text.toLowerCase().includes(mapping.hotword.toLowerCase())) {
              await fetch(`https://graph.facebook.com/v21.0/${process.env.PAGE_ID}/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recipient: { id: from.id }, message: { text: mapping.reply } })
              });
            }
          }
        }
      }
    }
  }
  res.sendStatus(200);
});

// ---------------- Webhook verification ----------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === process.env.VERIFY_TOKEN) res.send(challenge);
  else res.sendStatus(403);
});

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
