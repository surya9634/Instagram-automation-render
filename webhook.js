import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// Load hotwords
const HOTWORDS_FILE = "./hotwords.json";

// Webhook verification
app.get("/webhook", (req,res)=>{
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if(mode && token === "Work-Flow") res.send(challenge);
  else res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", async (req,res)=>{
  const body = req.body;
  const hotwords = fs.existsSync(HOTWORDS_FILE) ? JSON.parse(fs.readFileSync(HOTWORDS_FILE)) : {};

  if(body.entry){
    for(const entry of body.entry){
      for(const change of entry.changes){
        if(change.field==="feed"){
          const {comment_id, text, from, media_id} = change.value;
          // Check for hotwords
          for(const ig_user_id in hotwords){
            for(const mapping of hotwords[ig_user_id]){
              if(mapping.post_id===media_id && text.toLowerCase().includes(mapping.hotword.toLowerCase())){
                // Send DM
                await fetch(`https://graph.facebook.com/v21.0/${ig_user_id}/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,{
                  method:"POST",
                  headers:{"Content-Type":"application/json"},
                  body: JSON.stringify({
                    recipient:{id:from.id},
                    message:{text:mapping.reply}
                  })
                });
              }
            }
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

app.listen(3001, ()=>console.log("Webhook running on 3001"));
