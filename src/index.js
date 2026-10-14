import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const cfg = {
  image: path.resolve(process.env.ANCHOR_IMAGE_PATH || "assets/Woman_sitting_at_news_desk_2K_20261014083729.jpg"),
  name: process.env.CHANNEL_NAME || "देसी इंटरपोल",
  voice: process.env.EDGE_VOICE || "hi-IN-SwaraNeural",
  pexelsKey: process.env.PEXELS_API_KEY || "",
  work: path.resolve("work"),
  out: path.resolve("out"),
};
const font = "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf";
const sections = [
  { topic: "NATION", label: "राष्ट्रीय समाचार", query: "India parliament city news" },
  { topic: "WORLD", label: "अंतरराष्ट्रीय समाचार", query: "world city news globe" },
  { topic: "BUSINESS", label: "अर्थव्यवस्था", query: "stock market business technology" },
  { topic: "TECHNOLOGY", label: "तकनीक की दुनिया", query: "technology smartphone computer innovation" },
  { topic: "SPORTS", label: "खेल समाचार", query: "sports stadium cricket football" },
];

const run = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("error", reject);
  child.on("close", code => code ? reject(new Error(bin + " exited with " + code)) : resolve());
});
const clean = value => String(value).replaceAll("&amp;", "&").replaceAll("&quot;", '"').replace(/\s+/g, " ").trim();
const draw = value => String(value).replace(/[\\':,]/g, "\\$&");

async function headlines(section) {
  try {
    const url = new URL("https://news.google.com/rss/headlines/section/topic/" + section.topic);
    url.search = "hl=hi&gl=IN&ceid=IN:hi";
    const response = await fetch(url);
    if (!response.ok) throw new Error("RSS " + response.status);
    const xml = await response.text();
    const titles = xml.split("<title>").slice(2, 4).map(part => clean(part.split("</title>")[0])).filter(Boolean);
    if (titles.length === 2) return { ...section, titles };
  } catch (error) {
    console.warn("Headline fallback for " + section.label + ": " + error.message);
  }
  return { ...section, titles: ["इस क्षेत्र की ताज़ा प्रमुख खबरों पर लगातार नज़र", "विश्वसनीय स्रोतों से विस्तृत अपडेट की पुष्टि जारी"] };
}

async function downloadStockClip(part, index) {
  if (!cfg.pexelsKey) return null;
  try {
    const url = new URL("https://api.pexels.com/videos/search");
    url.searchParams.set("query", part.query);
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("per_page", "3");
    const response = await fetch(url, { headers: { Authorization: cfg.pexelsKey } });
    if (!response.ok) throw new Error("Pexels " + response.status);
    const data = await response.json();
    const video = data.videos && data.videos[0];
    const files = video && video.video_files;
    const file = files && files.filter(item => item.file_type === "video/mp4").sort((a, b) => Math.abs((a.width || 0) - 1080) - Math.abs((b.width || 0) - 1080))[0];
    if (!file || !file.link) throw new Error("No usable stock clip");
    const clipResponse = await fetch(file.link);
    if (!clipResponse.ok) throw new Error("Clip download " + clipResponse.status);
    const target = path.join(cfg.work, "stock-" + index + ".mp4");
    await writeFile(target, Buffer.from(await clipResponse.arrayBuffer()));
    return target;
  } catch (error) {
    console.warn("Animated stock clip unavailable for " + part.label + ": " + error.message);
    return null;
  }
}

function sectionText(part) {
  return "अब बात " + part.label + " की। पहली बड़ी खबर। " + part.titles[0] + "। दूसरी अहम अपडेट। " + part.titles[1] + "। इस घटनाक्रम पर हमारी नज़र बनी हुई है। विस्तृत जानकारी के लिए आधिकारिक स्रोतों की पुष्टि जरूर करें।";
}

async function createAudio(text, index) {
  const output = path.join(cfg.work, "audio-" + index + ".mp3");
  await run("edge-tts", ["--voice", cfg.voice, "--rate=-5%", "--text", text, "--write-media", output]);
  return output;
}

async function renderPart(part, index) {
  const audio = await createAudio(part.text, index);
  const video = path.join(cfg.work, "part-" + index + ".mp4");
  let input;
  let title = part.label;
  if (part.kind === "anchor") {
    input = ["-loop", "1", "-i", cfg.image, "-i", audio];
  } else {
    const stock = await downloadStockClip(part, index);
    input = stock ? ["-stream_loop", "-1", "-i", stock, "-i", audio] : ["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-i", audio];
  }
  const filter = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.06:saturation=1.12,fade=t=in:st=0:d=0.35,drawbox=x=0:y=0:w=1080:h=155:color=0x06183a@0.94:t=fill,drawbox=x=0:y=1660:w=1080:h=190:color=0x97071a@0.94:t=fill,drawbox=x=42:y=1710:w=12:h=82:color=0xffc400:t=fill,drawtext=fontfile=" + font + ":text=" + draw(cfg.name) + ":x=44:y=40:fontsize=54:fontcolor=white,drawtext=fontfile=" + font + ":text=" + draw(title) + ":x=75:y=1703:fontsize=42:fontcolor=white,drawtext=fontfile=" + font + ":text=LIVE:x=870:y=50:fontsize=34:fontcolor=0xffd34e,drawtext=fontfile=" + font + ":text=TOP\ NEWS:x=780:y=104:fontsize=24:fontcolor=white[v]";
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...input, "-filter_complex", filter, "-map", "[v]", "-map", "1:a", "-shortest", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", video]);
  return video;
}

async function main() {
  await access(cfg.image);
  await rm(cfg.work, { recursive: true, force: true });
  await rm(cfg.out, { recursive: true, force: true });
  await mkdir(cfg.work, { recursive: true });
  await mkdir(cfg.out, { recursive: true });
  console.log("Collecting verified headline categories…");
  const reports = await Promise.all(sections.map(headlines));
  const parts = [
    { kind: "anchor", label: "मुख्य समाचार", text: "नमस्कार। आप देख रहे हैं " + cfg.name + "। देश-दुनिया की बड़ी खबरों के तेज़ और साफ बुलेटिन में आपका स्वागत है। पहले जानते हैं इस समय की प्रमुख सुर्खियाँ।" },
    ...reports.map(report => ({ ...report, kind: "story", text: sectionText(report) })),
    { kind: "anchor", label: "बुलेटिन समाप्त", text: "तो ये थीं इस समय की प्रमुख खबरें। ऐसी ही तेज़, स्पष्ट और संतुलित खबरों के लिए " + cfg.name + " के साथ जुड़े रहिए। नमस्कार।" },
  ];
  await writeFile(path.join(cfg.work, "bulletin.json"), JSON.stringify({ channel: cfg.name, generatedAt: new Date().toISOString(), parts }, null, 2));
  console.log("Creating Hindi narration and changing visuals for each news section…");
  const videos = [];
  for (let index = 0; index < parts.length; index += 1) videos.push(await renderPart(parts[index], index));
  const inputs = videos.flatMap(file => ["-i", file]);
  const joins = videos.map((_, index) => "[" + index + ":v][" + index + ":a]").join("");
  const output = path.join(cfg.out, "desi-interpol-daily-bulletin.mp4");
  console.log("Joining TV-news segments with headline transitions…");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", joins + "concat=n=" + videos.length + ":v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", output]);
  console.log("Created " + output);
}

main().catch(error => { console.error("Bulletin failed: " + error.message); process.exit(1); });
