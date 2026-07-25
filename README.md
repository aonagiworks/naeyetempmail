# NaeyaTempMail

Disposable inbox web app powered by the public [mail.tm](https://docs.mail.tm/) API.

**Live:** https://aonagiworks.github.io/naeyetempmail/

## Features

- Modern Tailwind UI (dark/light mode)
- Generate random address via mail.tm
- Copy / refresh / new address
- Auto-poll inbox every 8s
- Email reader drawer (text + HTML)
- Session persisted in `localStorage`
- Zero backend (CORS open on mail.tm)

## Files

```
index.html  — layout
app.js      — mail.tm API + UI logic
style.css   — scrollbar / iframe / toast
README.md
```

## Run locally

```bash
cd /data/tempmail-app
python3 -m http.server 8765 --bind 0.0.0.0
```

## Brand

**NaeyaTempMail** — Aonagi & Zuzu Works
