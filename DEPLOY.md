# Deploying Kinara Relief (one service on Render)

One Node service hosts both the app and the API. The API lives under `/api`.

## 1. Put the project on GitHub

Create an empty repository on github.com (no README), then in the project folder:

```
git init
git add .
git commit -m "Kinara Relief"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/kinara-relief.git
git push -u origin main
```

`node_modules` and `dist` are ignored on purpose. `db.json` is included: it is the seed data the live site starts from.

## 2. Create the service on Render

1. Sign in at render.com with GitHub.
2. New, then Web Service, then pick the repository.
3. Fill in:
   - Language: Node
   - Build Command: `npm install --include=dev && npm run build`
   - Start Command: `npm start`
   - Instance Type: Free
   - Advanced, Health Check Path: `/api`
4. Create Web Service. The first build takes a few minutes. Render shows a link like `https://kinara-relief.onrender.com`.

(Or choose New, then Blueprint, which reads `render.yaml` and fills this in.)

## 3. Check it

- The link opens the Dashboard with a green "API connected" badge.
- `/api` shows the API description, and `/api/camps` shows the camps.
- Refreshing on a page such as `/camps` still works.

## Good to know

- **Free plan:** the service sleeps after about 15 minutes idle, so the first visit can take around 30 seconds. Open the link before presenting.
- **Data resets:** the disk is temporary. When the service restarts or redeploys, the data returns to the seed in `db.json`. A paid plan with a persistent disk keeps it.
- **Run it the same way locally:** `npm run build`, then `npm start`, then open http://localhost:3001.
- **Sign-in:** every request needs a login. Before you push, change both passwords: `npm run user -- set coordinator "..."` and `npm run user -- set volunteer "..."`, then commit `server/users.json` (it holds hashes only, never the passwords).
- **SESSION_SECRET:** in Render, Environment, add `SESSION_SECRET` with a long random value (Render can generate one in the blueprint). Without it, everyone is signed out whenever the service restarts.
- **Adding people later:** accounts are edited in `server/users.json` through `npm run user`, then redeployed.
