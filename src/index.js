import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const env = process.env;
const cfg = {
  name: env.CHANNEL_NAME || "देसी इंटरपोल",
  tagline: env.TAGLINE || "देश-दुनिया की बड़ी ख़बरें",
  key: env.GEMINI_API_KEY || "",
  model: env.GEMINI_MODEL || "gemini-3.8-flash",
  image: path.resolve(env.ANCHOR_IMAGE_PATH || "assets/desi-interpol-anchor.jpg"),
  avatar: (env.AVATAR_PROVIDER || "static").toLowerCase(),
  didKey: env.DID_API_KEY || "",
  didImage: env.DID_ANCHOR_IMAGE_URL || "",
  didVoice: env.DID_VOICE_ID || "hi-IN-SwaraNeural",
  edgeVoice: env.EDGE_VOICE || "hi-IN-SwaraNeural",
  work: path.resolve("work"), out: path.resolve("out")
};
const run = (bin, args, capture = false) => new Promise((resolve, reject) => {
  const p = spawn(bin, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" }); let out = "", err = "";
  p.stdout?.on("data", d => out += d); p.stderr?.on("data", d => err += d);
  p.on("error", reject); p.on("close", c => c ? reject(new Error(`${bin}: ${err.slice(-500)}`)) : resolve(out));
});
const ff = args => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/%/g, "\\%");
const itemTag = (xml, tag) => (xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").trim();

async function font() { return (await run("fc-match", ["-f", "%{file}", "Noto Sans Devanagari"], true)).trim(); }
async function news(topic, id, label) {
  const u = new URL(`https://news.google.com/rss/headlines/section/topic/${topic}`); u.search = "hl=hi&gl=IN&ceid=IN:hi";
  const r = await fetch(u); if (!r.ok) throw new Error(`News feed ${topic} failed`); const xml = await r.text();
  const stories = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => ({ title: itemTag(m[1], "title"), url: itemTag(m[1], "link"), source: itemTag(m[1], "source") || "Google News" })).filter(x => x.title).slice(0, 4);
  return { id, label, stories };
}
async function collect() {
  return Promise.all([news("NATION", "national", "राष्ट्रीय समाचार"), news("WORLD", "international", "अंतरराष्ट्रीय समाचार"), news("BUSINESS", "economy", "अर्थव्यवस्था"), news("TECHNOLOGY", "technology", "टेक्नोलॉजी"), news("SPORTS", "sports", "खेल")]);
}

  async function script(categories) {
const sources = categories.map(c => `${c.id} (${c.label}):\n${c.stories.map((s,i)=>`${i+1}. ${s.title} | ${s.source} | ${s.url}`).join("\n")}`).join("\n\n");
  const prompt = `You are the cautious Hindi editor for ${cfg.name}. Return JSON only: {"caption":"string","segments":[{"categoryId":"national","categoryLabel":"string","headline":"string","narration":"string","sourceName":"string","sourceUrl":"string"}]}. Return exactly five segments in order national, international, economy, technology, sports. Each narration must be 55-65 natural Hindi words. Use ONLY supplied headlines. Never invent facts, numbers, quotes, causes, outcomes, or allegations. Keep neutral language and preserve a selected source name and URL.\n\n${sources}`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.key)}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1,maxOutputTokens:4096}}) });
  const body = await r.json(); if (!r.ok) throw new Error(body?.error?.message || "Gemini failed");
  const text = body?.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p=>p.text||"").join(""); const result = JSON.parse(text);
  const ids = ["national","international","economy","technology","sports"];
  if (!Array.isArray(result.segments) || result.segments.length !== 5 || result.segments.some((s,i)=>s.categoryId !== ids[i])) throw new Error("The AI returned an incomplete bulletin.");
  return result;
}
async function didClip(text, index) {
  if (cfg.avatar !== "did") return null;
  if (!cfg.didKey || !cfg.didImage) throw new Error("D-ID mode needs DID_API_KEY and DID_ANCHOR_IMAGE_URL.");
  const r = await fetch("https://api.d-id.com/talks", {method:"POST",headers:{authorization:`Basic ${cfg.didKey}`,"content-type":"application/json"},body:JSON.stringify({source_url:cfg.didImage,script:{type:"text",input:text,provider:{type:"microsoft",voice_id:cfg.didVoice}}})});
  const job = await r.json(); if (!r.ok || !job.id) throw new Error("D-ID could not create the anchor clip.");
  for (let i=0;i<90;i++) { await wait(5000); const s=await fetch(`https://api.d-id.com/talks/${job.id}`,{headers:{authorization:`Basic ${cfg.didKey}`}}); const j=await s.json(); if (j.status === "done" && j.result_url) { const d=path.join(cfg.work,`raw-${index}.mp4`); await writeFile(d,Buffer.from(await (await fetch(j.result_url)).arrayBuffer())); return d; } if (["error","rejected"].includes(j.status)) throw new Error("D-ID rejected an anchor clip."); }
  throw new Error("D-ID clip timed out.");
}
async function card(segment, index, f) {
  const output=path.join(cfg.work,`card-${index}.mp4`); const filter=[`drawbox=x=0:y=0:w=iw:h=ih:color=0x07183d:t=fill`,`drawtext=fontfile='${esc(f)}':text='${esc(cfg.name)}':fontcolor=white:fontsize=74:x=(w-tw)/2:y=540`,`drawtext=fontfile='${esc(f)}':text='${esc(segment.categoryLabel)}':fontcolor=0xffc84d:fontsize=65:x=(w-tw)/2:y=760`,`drawtext=fontfile='${esc(f)}':text='${esc(segment.headline)}':fontcolor=white:fontsize=42:x=(w-tw)/2:y=940`].join(",");
  await ff(["-f","lavfi","-i","color=c=0x07183d:s=1080x1920:r=30:d=3","-f","lavfi","-i","anullsrc=r=44100:cl=stereo","-vf",filter,"-shortest","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",output]); return output;
}
async function anchor(segment,index,f) {
  const out=path.join(cfg.work,`anchor-${index}.mp4`); const raw=await didClip(`${segment.categoryLabel}. ${segment.narration}`,index); const lower=`drawbox=x=0:y=h-270:w=iw:h=210:color=0xb00020@0.93:t=fill,drawtext=fontfile='${esc(f)}':text='${esc(segment.categoryLabel)}':fontcolor=0xffd76b:fontsize=30:x=55:y=h-240,drawtext=fontfile='${esc(f)}':text='${esc(segment.headline)}':fontcolor=white:fontsize=38:x=55:y=h-180,drawtext=fontfile='${esc(f)}':text='AI एंकर • स्रोत स्क्रीन पर':fontcolor=white:fontsize=25:x=55:y=38`;
  if (raw) { await ff(["-i",raw,"-vf",`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${lower}`,"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",out]); return out; }
  await access(cfg.image); const audio=path.join(cfg.work,`voice-${index}.mp3`); await run("edge-tts",["--voice",cfg.edgeVoice,"--text",`${segment.categoryLabel}. ${segment.narration}`,"--write-media",audio]);
  await ff(["-loop","1","-framerate","30","-i",cfg.image,"-i",audio,"-filter_complex",`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.00025,1.035)':d=1:s=1080x1920:fps=30,${lower}[v]`,"-map","[v]","-map","1:a","-shortest","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",out]); return out;
}
async function title(text, file, f) { await ff(["-f","lavfi","-i","color=c=0x07183d:s=1080x1920:r=30:d=4","-f","lavfi","-i","anullsrc=r=44100:cl=stereo","-vf",`drawtext=fontfile='${esc(f)}':text='${esc(cfg.name)}':fontcolor=white:fontsize=82:x=(w-tw)/2:y=650,drawtext=fontfile='${esc(f)}':text='${esc(text)}':fontcolor=0xffc84d:fontsize=42:x=(w-tw)/2:y=820`,`-shortest`,`-c:v`,`libx264`,`-pix_fmt`,`yuv420p`,`-c:a`,`aac`,file]); return file; }
async function main() {
  if (!cfg.key) throw new Error("Add GEMINI_API_KEY as a GitHub Actions secret."); if (!["static","did"].includes(cfg.avatar)) throw new Error("AVATAR_PROVIDER must be static or did.");
  await rm(cfg.work,{recursive:true,force:true}); await mkdir(cfg.work,{recursive:true}); await mkdir(cfg.out,{recursive:true}); const f=await font();
  console.log("Collecting current headlines…"); const headlines=await collect(); console.log("Writing Hindi bulletin…"); let bulletin;for(let i=0;i<4;i++){try{bulletin=await script(headlines);break}catch(e){if(i===3)throw e;console.warn(`Gemini busy; retry ${i+2}/4`);await wait((i+1)*15000)}} await writeFile(path.join(cfg.work,"bulletin.json"),JSON.stringify({headlines,bulletin},null,2));
  const clips=[await title(cfg.tagline,path.join(cfg.work,"intro.mp4"),f)]; for (const [i,s] of bulletin.segments.entries()) clips.push(await card(s,i+1,f),await anchor(s,i+1,f)); clips.push(await title("देखने के लिए धन्यवाद",path.join(cfg.work,"outro.mp4"),f));
  const list=path.join(cfg.work,"list.txt"); await writeFile(list,clips.map(x=>`file '${x.replace(/'/g,"'\\''")}'`).join("\n")); const final=path.join(cfg.out,"desi-interpol-daily-bulletin.mp4"); await ff(["-f","concat","-safe","0","-i",list,"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",final]); console.log(`Ready: ${final}`); console.log("Review the artifact before publishing.");
}
main().catch(e=>{console.error(`Bulletin failed: ${e.message}`);process.exitCode=1;});
