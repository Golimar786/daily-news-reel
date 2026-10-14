import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";


const env = process.env;
const cfg = {
  name: env.CHANNEL_NAME || "देसी इंटरपोल",
  tagline: env.TAGLINE || "देश-दुनिया की बड़ी ख़बरें",
  key: env.GEMINI_API_KEY || "",
  model: env.GEMINI_MODEL || "gemini-3.8-flash",
  image: path.resolve(env.ANCHOR_IMAGE_PATH || "assets/Woman_sitting_at_news_desk_2K_20261014083729.jpg"),
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
