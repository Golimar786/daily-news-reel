# देसी इंटरपोल — Daily Hindi News Bulletin

This complete starter project produces a 9:16 Hindi bulletin with National, International, Economy, Technology, and Sports sections; branded graphics; source-aware script JSON; and your anchor image.

## Install it in your GitHub repository

1. Upload every file from this folder to a new GitHub repository.
2. Upload your original anchor image as `assets/desi-interpol-anchor.jpg`.
3. In **Settings → Secrets and variables → Actions → Secrets**, add `GEMINI_API_KEY`.
4. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `CHANNEL_NAME` = `देसी इंटरपोल`
   - `TAGLINE` = `देश-दुनिया की बड़ी ख़बरें`
   - `AVATAR_PROVIDER` = `static`
5. Run **Actions → Desi Interpol Daily Bulletin → Run workflow**. Download the `desi-interpol-bulletin` artifact.

The first test uses Edge TTS plus your still anchor image. Once the graphics and voice are correct, enable natural movement and lip-sync:

1. Get a D-ID API key and add it as secret `DID_API_KEY`.
2. Host the same anchor image at a public HTTPS URL and add it as variable `DID_ANCHOR_IMAGE_URL`.
3. Change `AVATAR_PROVIDER` to `did`.

The project uses D-ID's documented photo-avatar `POST /talks` job and status-polling workflow to create each speaking section. [D-ID documentation](https://docs.d-id.com/docs/v2-photo-avatar-quickstart)

Keep review enabled before publishing. The project deliberately does not auto-post to Instagram until a separate public-video hosting step is configured and you explicitly choose to enable it.
