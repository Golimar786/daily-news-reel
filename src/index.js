import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const cfg = {
  image: path.resolve("assets/Woman_sitting_at_news_desk_2K_20261014083729.jpg"),
  name: process.env.CHANNEL_NAME || "देसी इंटरपोल",
  voice: process.env.EDGE_VOICE || "hi-IN-SwaraNeural",
  work: path.resolve("work"),
  out: path.resolve("out"),
};

const run = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("error", reject);
  child.on("close", code => code ? reject(new Error(bin + " exited with " + code)) : resolve());
});

const clean = value => String(value).replaceAll("&amp;", "&").replaceAll("&quot;", '"').trim();
const sections = [["NATION", "राष्ट्रीय समाचार"], ["WORLD", "अंतरराष्ट्रीय समाचार"], ["BUSINESS", "अर्थव्यवस्था और कारोबार"], ["TECHNOLOGY", "तकनीक की दुनिया"], ["SPORTS", "खेल समाचार"]];

async function headlines(topic, label) {
  try {
    const url = new URL("https://news.google.com/rss/headlines/section/topic/" + topic);
    url.search = "hl=hi&gl=IN&ceid=IN:hi";
    const response = await fetch(url);
    if (!response.ok) throw new Error("feed " + response.status);
    const xml = await response.text();
    const titles = xml.split("<title>").slice(2, 5).map(part => clean(part.split("</title>")[0])).filter(Boolean);
    if (titles.length) return { label, titles };
  } catch (error) {
    console.warn("Using fallback headlines for " + topic + ": " + error.message);
  }
  return { label, titles: ["इस क्षेत्र की ताज़ा सुर्खियों पर लगातार नज़र", "विश्वसनीय स्रोतों से खबरों की पुष्टि जारी", "विस्तृत अपडेट अगली बुलेटिन में"] };
}

function bulletin(items) {
  const opening = "नमस्कार। आप देख रहे हैं " + cfg.name + "। मैं हूँ आपकी समाचार प्रस्तोता। देश-दुनिया की बड़ी खबरों के इस विशेष बुलेटिन में आपका स्वागत है। हम हर खबर को उपलब्ध विश्वसनीय स्रोतों के आधार पर संक्षेप में रख रहे हैं।";
  const body = items.map(item => {
    const list = item.titles.map((title, index) => "खबर नंबर " + (index + 1) + "। " + title + "।").join(" ");
    return "अब बात " + item.label + " की। " + list + " इन घटनाक्रमों पर हमारी नज़र बनी हुई है। किसी भी तेजी से बदलती खबर के लिए आधिकारिक घोषणा और विश्वसनीय रिपोर्ट की पुष्टि जरूर करें।";
  }).join(" ");
  const closing = "तो ये थीं इस समय की प्रमुख खबरें। ऐसी ही साफ, संतुलित और तेज खबरों के लिए " + cfg.name + " के साथ जुड़े रहिए। नमस्कार।";
  return opening + " " + body + " " + closing;
}

async function main() {
  await access(cfg.image);
  await rm(cfg.work, { recursive: true, force: true });
  await rm(cfg.out, { recursive: true, force: true });
  await mkdir(cfg.work, { recursive: true });
  await mkdir(cfg.out, { recursive: true });
  console.log("Collecting headline categories…");
  const items = await Promise.all(sections.map(([topic, label]) => headlines(topic, label)));
  const narration = bulletin(items);
  await writeFile(path.join(cfg.work, "bulletin.json"), JSON.stringify({ channel: cfg.name, generatedAt: new Date().toISOString(), items, narration }, null, 2));
  const audio = path.join(cfg.work, "narration.mp3");
  console.log("Creating Hindi narration with Edge TTS…");
  await run("edge-tts", ["--voice", cfg.voice, "--rate=-8%", "--text", narration, "--write-media", audio]);
  const video = path.join(cfg.out, "desi-interpol-daily-bulletin.mp4");
  console.log("Rendering anchor bulletin video…");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", cfg.image, "-i", audio, "-filter_complex", "[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=min(zoom+0.00035\\,1.08):d=1:s=1080x1920:fps=30,boxblur=20:2,eq=brightness=-0.22[bg];[b]scale=850:-1[anchor];[bg][anchor]overlay=x=(W-w)/2:y=300[base];[base]drawbox=x=0:y=0:w=1080:h=170:color=0x071a3d@0.92:t=fill,drawbox=x=0:y=1670:w=1080:h=170:color=0x9e0716@0.92:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf:text=देसी इंटरपोल:x=44:y=40:fontsize=54:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf:text=देश-दुनिया की बड़ी खबरें:x=44:y=1715:fontsize=42:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf:text=LIVE\  •\  TOP\  NEWS:x=720:y=55:fontsize=28:fontcolor=0xffd34e[v]", "-map", "[v]", "-map", "1:a", "-shortest", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", video]);
  console.log("Created " + video);
}

main().catch(error => { console.error("Bulletin failed: " + error.message); process.exit(1); });
