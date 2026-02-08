# Shop the Frame (UofT Hacks)

[![demo video](https://img.youtube.com/vi/0ceemUPquRQ/0.jpg)](https://www.youtube.com/watch?v=0ceemUPquRQ)

Shop the Frame is a Chrome extension + Express backend that lets you capture a YouTube video frame, detect items in the scene with Gemini, and return Shopify product matches.

## Features
- One-click capture from a YouTube watch page
- Gemini-powered item detection + query generation
- Shopify catalog search (real API or mock fallback)
- Clean side panel UI with detected items and product cards

## Project Structure
- `backend/` Express API for image upload + Gemini + Shopify search
- `extension/` Chrome extension (content + background scripts)
- `Shop the Frame UI Design/` Vite-based UI exploration (optional)

## Quickstart
### 1) Backend
```bash
cd backend
npm install
```

Create `backend/.env`:
```bash
GEMINI_API_KEY=your_gemini_api_key
# PostgreSQL
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<database>
# Optional, set to false if your local Postgres does not use SSL
# PGSSL=false
# Optional: use real Shopify catalog search
SHOPIFY_CLIENT_ID=your_shopify_client_id
SHOPIFY_CLIENT_SECRET=your_shopify_client_secret
# Optional: force mock responses
# SHOPIFY_USE_MOCK=true
PORT=3000
```

Run the server:
```bash
npm run dev
```

### 2) Chrome extension
1. Open Chrome -> `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. Open any YouTube watch page, click **Shop this frame**

The extension calls `http://localhost:3000/shop-frame` and expects the backend to be running.

## API
- `POST /health` -> `{ ok: true }`
- `POST /shop-frame` -> `multipart/form-data` with `image` field

## PostgreSQL
The backend stores sessions, events, and analytics events in PostgreSQL. Ensure `DATABASE_URL` is set.

### Example documents
Session
```json
{
  "sessionId": "b25d9c6f-1ad6-4e50-9c90-4a9f1f2d7e1b",
  "videoId": "dQw4w9WgXcQ",
  "timestampSec": 123.45,
  "frameHash": "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  "items": [
    { "item": "black graphic tee", "confidence": 0.82 }
  ],
  "results": [
    {
      "item": { "query": "black graphic tee", "confidence": 0.8 },
      "products": [
        { "title": "Black Graphic Tee", "url": "https://shop.example/black-tee" }
      ]
    }
  ],
  "createdAt": "2024-11-19T12:34:56.789Z"
}
```

Event
```json
{
  "type": "product_click",
  "sessionId": "b25d9c6f-1ad6-4e50-9c90-4a9f1f2d7e1b",
  "itemQuery": "black graphic tee",
  "itemCategory": "tops",
  "productUrl": "https://shop.example/black-tee",
  "productRank": 1,
  "createdAt": "2024-11-19T12:35:01.123Z",
  "latencyMs": 842
}
```

## Notes
- Image upload limit is 10MB.
- Shopify search defaults to mock data if credentials are missing.
- The UI design folder is a standalone Vite app for visual exploration.

## Tech
- Node.js, Express, Multer
- Gemini (Google Generative AI)
- Chrome Extension (MV3)
- Shopify Catalog API (optional)
