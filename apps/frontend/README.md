# EKIP frontend

The frontend is the React 19 and Vite application in this directory. It
provides the browser UI for EKIP; the Express backend and data services must
also be running for authenticated features.

## Run locally

From this directory:

```powershell
npm ci
npm run dev
```

Set `VITE_API_URL` in `.env` to the backend URL used by the browser, normally
`http://localhost:5000`. Open <http://localhost:5173>.

## Checks

```powershell
npm run lint
npm run build
```

For full-stack setup, Docker, environment configuration, and user instructions,
see the repository [README](../../README.md).
