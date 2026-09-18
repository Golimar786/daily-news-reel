# Daily News Reel

Every morning and evening this fetches India + world news, writes a short script,
generates Veo visuals and a voiceover, builds a 9:16 Reel with headlines, and posts
it to Instagram. It runs free on GitHub Actions, so nothing runs on your PC.

## Cost: FREE by default
Script = Gemini free tier, visuals = Pexels stock videos, voice = Microsoft Edge TTS,
running = GitHub Actions free minutes, posting = Instagram API.

## 1. Get your keys (all free)
- GEMINI_API_KEY: aistudio.google.com > Get API key. No billing needed for the free tier.
- PEXELS_API_KEY: pexels.com/api > sign up > copy key.
- Voice needs no key. Change voice with variable EDGE_VOICE:
  hi-IN-SwaraNeural (female) or hi-IN-MadhurNeural (male).
- IG_USER_ID + IG_ACCESS_TOKEN:
  1. Instagram must be a Business or Creator account linked to a Facebook Page.
  2. Create a Meta app (developers.facebook.com) with permissions
     instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement.
  3. Use a System User token from Meta Business Settings. It does not expire.
     (Normal user tokens die after 60 days, which silently breaks automations.)
  4. Get the IG user id: GET /me/accounts, then /{page-id}?fields=instagram_business_account

## 2. Put it on GitHub
1. Create a private repo and upload this folder.
2. Settings > Secrets and variables > Actions:
   - Secrets: GEMINI_API_KEY, PEXELS_API_KEY, IG_USER_ID, IG_ACCESS_TOKEN
   - Variables (optional): LANGUAGE, CHANNEL_NAME, EDGE_VOICE, DRY_RUN
3. Actions tab > Daily News Reel > Run workflow.
4. Download the "reel" artifact and watch the video.
5. Happy with it for a few days? Set variable DRY_RUN = false and it starts posting.

## Optional
- Background music: add assets/music.mp3 (royalty-free).
- Paid upgrade later: set VISUAL_SOURCE=veo and/or TTS_ENGINE=elevenlabs and add those keys.
- Test on your PC: install Node 22 + FFmpeg + `pip install edge-tts`, copy .env.example to .env, then
  npm install && npm run local

## Notes
- GitHub pauses scheduled workflows if the repo has no activity for 60 days. Commit something occasionally.
- If a run fails, GitHub emails you and the log shows exactly which step broke.
