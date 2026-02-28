<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/80433b07-89c8-4f55-b01f-60f63b908fd5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create a local env file:
   `cp .env.example .env.local`
3. Set `MUSICFY_API_KEY` in `.env.local` for Musicfy voice conversion
4. (Optional) Set `GEMINI_API_KEY` if you use Gemini features
5. Run the app:
   `npm run dev`

## Persistence

- Saved characters are stored in `data/ball_drop.sqlite`
- Generated cover outputs are downloaded to `storage/audio/`
- These are reused after restart so you can pick previously saved characters and outputs
