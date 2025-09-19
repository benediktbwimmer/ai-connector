# AI Connector Frontend

React + TypeScript single-page app that talks to the AI Connector FastAPI backend. It provides chat, profile/settings, and live monitoring experiences.

## Available scripts

```bash
npm install        # install dependencies
npm run dev        # start Vite dev server (defaults to http://localhost:5173)
npm run build      # production build (emitted to dist/)
```

Set `VITE_API_BASE_URL` to point at a running backend when developing against a remote instance:

```bash
VITE_API_BASE_URL="http://localhost:8000" npm run dev
```

The Docker image builds this frontend automatically and serves the compiled assets via FastAPI.
