// Daily News Reel — fetch news -> script -> Veo visuals -> voiceover -> reel -> Instagram
import { GoogleGenAI } from "@google/genai";
import Parser from "rss-parser";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------- CONFIG ----------------
const E = (k, d) => (process.env[k] && process.env[k].trim()) || d;
const DRY_RUN = E("DRY_RUN", "true") === "true"; // true = build video only, don't post
const CFG = {
  geminiKey: E("GEMINI_API_KEY"),
  textModel: E("GEMINI_TEXT_MODEL", "gemini-2.5-flash"),
  veoModel: E("VEO_MODEL", "veo-3.0-fast-generate-001"),
  maxVeoClips: Number(E("MAX_VEO_CLIPS", "3")), // only used when VISUAL_SOURCE=veo
  visualSource: E("VISUAL_SOURCE", "pexels"), // "pexels" (free) or "veo" (paid)
  pexelsKey: E("PEXELS_API_KEY"),
  ttsEngine: E("TTS_ENGINE", "edge"), // "edge" (free) or "elevenlabs" (paid)
  edgeVoice: E("EDGE_VOICE", "hi-IN-SwaraNeural"), // or hi-IN-MadhurNeural (male)
  language: E("LANGUAGE", "Hindi"),
  channelName: E("CHANNEL_NAME", "Daily News"),
  elevenKey: E("ELEVENLABS_API_KEY"),
  voiceId: E("ELEVENLABS_VOICE_ID"),
  igUserId: E("IG_USER_ID"),
  igToken: E("IG_ACCESS_TOKEN"),
  graphVersion: E("GRAPH_VERSION", "v21.0"),
  music: E("MUSIC_FILE", "assets/music.mp3"), // optional
};
const FEEDS = E("FEEDS")
  ? E("FEEDS").split(",")
  : [
      "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
      "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en",
      "https://www.thehindu.com/news/national/feeder/default.rss",
      "https://feeds.bbci.co.uk/news/world/rss.xml",
    ];

// ---------------- HELPERS ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1e8 }).toString();
  } catch (e) {
    throw new Error(`${cmd} failed:\n${e.stderr?.toString().slice(-2000)}`);
  }
}
const duration = (f) =>
  parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));
function requireKeys(keys) {
  const missing = keys.filter((k) => !CFG[k]);
  if (missing.length) throw new Error(`Missing config: ${missing.join(", ")}`);
}

// ---------------- 1. FETCH NEWS ----------------
async function fetchNews() {
  const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 news-reel-bot" } });
  const cutoff = Date.now() - 30 * 3600 * 1000;
  const items = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url.trim());
      for (const it of feed.items.slice(0, 25)) {
        const t = it.isoDate ? Date.parse(it.isoDate) : Date.now();
        if (t < cutoff) continue;
        items.push({ source: feed.title, title: it.title, summary: (it.contentSnippet || "").slice(0, 300) });
      }
    } catch (e) {
      console.warn(`  Feed failed (skipping): ${url} — ${e.message}`);
    }
  }
  if (items.length < 5) throw new Error(`Only ${items.length} news items fetched — check feeds`);
  return items.slice(0, 80);
}

// ---------------- 2. WRITE SCRIPT ----------------
async function writeScript(ai, items, dateStr) {
  const prompt = `You are the editor of "${CFG.channelName}", a short daily news Reel for Indian viewers.
Date: ${dateStr}. Language for intro, headline, narration, outro and caption: ${CFG.language}.

From the headlines below, pick the 5 most important stories: 3 about India and 2 about the world.
Skip duplicates, rumours, celebrity gossip and anything graphic.
Rules:
- Only state facts present in the headlines/summaries. Never invent numbers, quotes or names.
- Write in your own words; never copy sentences from the source.
- Neutral tone, no political opinion.
- intro: 1 short sentence. outro: 1 short sentence asking viewers to follow for daily updates.
- narration: 2 short sentences per story (about 10-12 seconds spoken).
- headline: max 8 words, for on-screen text.
- search_keywords (always English): 2-4 simple words to find a stock video for this story, e.g. "stock market screen", "rain city street", "cricket stadium".
- visual_prompt (always English): a cinematic vertical 9:16, 8-second b-roll shot that symbolises the story.
  No real or identifiable people, no politicians, no logos, no text, no violence, no disaster footage.
  Use places, objects, maps, landscapes, abstract motion graphics.

Return ONLY JSON:
{"intro":"...","stories":[{"region":"India|World","headline":"...","narration":"...","search_keywords":"...","visual_prompt":"...","source":"..."}],"outro":"...","caption":"...","hashtags":["..."]}

HEADLINES:
${items.map((it, i) => `${i + 1}. [${it.source}] ${it.title} — ${it.summary}`).join("\n")}`;

  const res = await ai.models.generateContent({
    model: CFG.textModel,
    contents: prompt,
    config: { responseMimeType: "application/json", temperature: 0.4 },
  });
  const data = JSON.parse(res.text.replace(/```json|```/g, "").trim());
  if (!data.stories?.length) throw new Error("Script came back with no stories");
  return data;
}

// ---------------- 3. VOICE (Edge TTS free / ElevenLabs paid) ----------------
async function tts(text, outFile) {
  if (CFG.ttsEngine === "edge") {
    run("edge-tts", ["--voice", CFG.edgeVoice, "--rate=+8%", "--text", text, "--write-media", outFile]);
    return;
  }
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${CFG.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": CFG.elevenKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    }
  );
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  fs.writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
}

// ---------------- 4a. VISUALS (Pexels, free) ----------------
async function getPexelsClip(keywords, outFile, used) {
  for (const q of [keywords, "india city", "world map globe"]) {
    if (!q) continue;
    try {
      const r = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=10`,
        { headers: { Authorization: CFG.pexelsKey } }
      );
      if (!r.ok) throw new Error(`Pexels ${r.status}`);
      const { videos = [] } = await r.json();
      for (const v of videos) {
        if (used.has(v.id)) continue; // don't repeat the same clip in one reel
        const file = v.video_files
          .filter((f) => f.file_type === "video/mp4" && f.height > f.width && f.width <= 1080)
          .sort((a, b) => b.width - a.width)[0];
        if (!file) continue;
        const dl = await fetch(file.link);
        if (!dl.ok) continue;
        fs.writeFileSync(outFile, Buffer.from(await dl.arrayBuffer()));
        used.add(v.id);
        return true;
      }
    } catch (e) {
      console.warn(`  Pexels search "${q}" failed: ${e.message}`);
    }
  }
  return false;
}

// ---------------- 4b. VISUALS (Veo, paid) ----------------
async function genClip(ai, prompt, outFile) {
  try {
    let op = await ai.models.generateVideos({
      model: CFG.veoModel,
      prompt,
      config: { aspectRatio: "9:16", numberOfVideos: 1 },
    });
    const start = Date.now();
    while (!op.done) {
      if (Date.now() - start > 6 * 60 * 1000) throw new Error("Veo timed out");
      await sleep(10000);
      op = await ai.operations.getVideosOperation({ operation: op });
    }
    const vid = op.response?.generatedVideos?.[0]?.video;
    if (!vid) throw new Error("No video returned (maybe blocked by safety filter)");
    await ai.files.download({ file: vid, downloadPath: outFile });
    for (let i = 0; i < 30 && !(fs.existsSync(outFile) && fs.statSync(outFile).size > 0); i++) await sleep(1000);
    return fs.existsSync(outFile);
  } catch (e) {
    console.warn(`  Veo failed, using plain background: ${e.message}`);
    return false;
  }
}

// ---------------- 5. VIDEO ASSEMBLY (FFmpeg) ----------------
function makeSegment(clip, audio, outFile, bgColor) {
  const dur = duration(audio) + 0.5;
  const vIn = clip
    ? ["-stream_loop", "-1", "-i", clip]
    : ["-f", "lavfi", "-i", `color=c=${bgColor}:s=1080x1920:r=30`];
  const vf = clip
    ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p"
    : "format=yuv420p";
  run("ffmpeg", [
    "-y", ...vIn, "-i", audio,
    "-map", "0:v", "-map", "1:a", "-vf", vf, "-af", "apad", "-t", dur.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", outFile,
  ]);
  return dur;
}

const assTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};
const assText = (t) => String(t).replace(/[{}\\]/g, "").replace(/\n/g, " ");

function writeSubtitles(events, total, file) {
  // ASS subtitles render Hindi (Devanagari) correctly via libass
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Head,Noto Sans Devanagari,66,&H00FFFFFF,&H000000FF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,3,20,0,2,70,70,300,1",
    "Style: Label,Noto Sans,40,&H00FFFFFF,&H000000FF,&H002020C0,&H002020C0,1,0,0,0,100,100,2,0,3,12,0,2,70,70,470,1",
    "Style: Tag,Noto Sans,32,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,10,0,8,40,40,110,1",
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${assTime(0)},${assTime(total)},Tag,,0,0,0,,${CFG.visualSource === "veo" ? "AI-generated visuals" : "Representative visuals"}`,
  ];
  for (const ev of events) {
    if (ev.label) lines.push(`Dialogue: 0,${assTime(ev.start)},${assTime(ev.end)},Label,,0,0,0,,${assText(ev.label)}`);
    lines.push(`Dialogue: 0,${assTime(ev.start)},${assTime(ev.end)},Head,,0,0,0,,${assText(ev.text)}`);
  }
  fs.writeFileSync(file, lines.join("\n"));
}

function finalRender(segFiles, assFile, outFile, dir) {
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, segFiles.map((s) => `file '${path.resolve(s)}'`).join("\n"));
  const joined = path.join(dir, "joined.mp4");
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

  const hasMusic = fs.existsSync(CFG.music);
  const inputs = ["-i", joined, ...(hasMusic ? ["-stream_loop", "-1", "-i", CFG.music] : [])];
  const fc = hasMusic
    ? `[0:v]subtitles=${assFile}[v];[1:a]volume=0.10[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`
    : `[0:v]subtitles=${assFile}[v]`;
  run("ffmpeg", [
    "-y", ...inputs, "-filter_complex", fc,
    "-map", "[v]", "-map", hasMusic ? "[a]" : "0:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile,
  ]);
}

// ---------------- 6. INSTAGRAM (direct upload, no public URL needed) ----------------
async function gpost(url, params) {
  const r = await fetch(url, { method: "POST", body: new URLSearchParams({ ...params, access_token: CFG.igToken }) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Graph API: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function publishReel(file, caption) {
  const G = `https://graph.facebook.com/${CFG.graphVersion}`;
  const size = fs.statSync(file).size;

  const c = await gpost(`${G}/${CFG.igUserId}/media`, {
    media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true",
  });

  const up = await fetch(`https://rupload.facebook.com/ig-api-upload/${CFG.graphVersion}/${c.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${CFG.igToken}`, offset: "0", file_size: String(size) },
    body: fs.readFileSync(file),
  });
  if (!up.ok) throw new Error(`Upload failed ${up.status}: ${await up.text()}`);

  for (let i = 0; ; i++) {
    await sleep(10000);
    const s = await (
      await fetch(`${G}/${c.id}?fields=status_code,status`, { headers: { Authorization: `Bearer ${CFG.igToken}` } })
    ).json();
    console.log(`  Instagram processing: ${s.status_code}`);
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error(`Instagram processing error: ${JSON.stringify(s)}`);
    if (i > 60) throw new Error("Instagram processing timed out");
  }
  return (await gpost(`${G}/${CFG.igUserId}/media_publish`, { creation_id: c.id })).id;
}

// ---------------- MAIN ----------------
async function main() {
  requireKeys([
    "geminiKey",
    ...(CFG.visualSource === "pexels" ? ["pexelsKey"] : []),
    ...(CFG.ttsEngine === "elevenlabs" ? ["elevenKey", "voiceId"] : []),
    ...(DRY_RUN ? [] : ["igUserId", "igToken"]),
  ]);
  const ai = new GoogleGenAI({ apiKey: CFG.geminiKey });
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }).format(now);
  const dir = path.resolve("out", now.toISOString().slice(0, 16).replace(/[:T]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });

  console.log("1/5 Fetching news…");
  const items = await fetchNews();
  console.log(`  ${items.length} items`);

  console.log("2/5 Writing script…");
  const script = await writeScript(ai, items, dateStr);
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script, null, 2));

  const parts = [
    { narration: script.intro, text: `${CFG.channelName} • ${dateStr}`, bg: "0x7a1414" },
    ...script.stories.map((s) => ({
      narration: s.narration, text: s.headline, label: (s.region || "").toUpperCase(),
      visual: s.visual_prompt, keywords: s.search_keywords, bg: "0x0b1f3a",
    })),
    { narration: script.outro, text: CFG.channelName, bg: "0x7a1414" },
  ];

  console.log("3/5 Voice + visuals…");
  const segFiles = [], events = [];
  let t = 0, veoUsed = 0;
  const usedPexels = new Set();
  for (const [i, p] of parts.entries()) {
    const audio = path.join(dir, `a${i}.mp3`);
    await tts(p.narration, audio);
    let clip = null;
    if (p.visual && CFG.visualSource === "pexels") {
      const f = path.join(dir, `v${i}.mp4`);
      if (await getPexelsClip(p.keywords, f, usedPexels)) clip = f;
    } else if (p.visual && veoUsed < CFG.maxVeoClips) {
      const f = path.join(dir, `v${i}.mp4`);
      console.log(`  Veo clip ${veoUsed + 1}/${CFG.maxVeoClips}…`);
      if (await genClip(ai, p.visual, f)) clip = f;
      veoUsed++;
    }
    const seg = path.join(dir, `s${i}.mp4`);
    const d = makeSegment(clip, audio, seg, p.bg);
    events.push({ start: t, end: t + d, text: p.text, label: p.label });
    segFiles.push(seg);
    t += d;
  }

  console.log("4/5 Rendering reel…");
  const ass = path.join(dir, "subs.ass");
  writeSubtitles(events, t, ass);
  const final = path.join(dir, "reel.mp4");
  finalRender(segFiles, ass, final, dir);
  console.log(`  Done: ${final} (${t.toFixed(1)}s)`);

  const sources = [...new Set(script.stories.map((s) => s.source).filter(Boolean))].join(", ");
  const visualNote = CFG.visualSource === "veo" ? "Visuals are AI-generated." : "Representative visuals from Pexels.";
  const caption = `${script.caption}\n\n${visualNote} Sources: ${sources}\n\n${(script.hashtags || [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`.slice(0, 2200);
  fs.writeFileSync(path.join(dir, "caption.txt"), caption);

  if (DRY_RUN) return console.log("5/5 DRY_RUN=true — not posting. Check out/ folder.");
  console.log("5/5 Posting to Instagram…");
  console.log(`  Published! Media ID: ${await publishReel(final, caption)}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
