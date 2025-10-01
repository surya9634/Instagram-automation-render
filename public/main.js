const urlParams = new URLSearchParams(window.location.search);
const username = urlParams.get("username");
const ig_user_id = urlParams.get("id");

document.getElementById("username").innerText = username;
document.getElementById("ig_user_id").value = ig_user_id;

const form = document.getElementById("hotword-form");
form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const post_id = document.getElementById("post_id").value;
  const hotword = document.getElementById("hotword").value;
  const reply = document.getElementById("reply").value;

  const res = await fetch("/save-hotword", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ ig_user_id, post_id, hotword, reply })
  });
  const data = await res.json();
  if(data.success) alert("Hotword saved!");
});
