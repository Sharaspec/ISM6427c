# Boca Weather

A responsive weather app with live data from [Open-Meteo](https://open-meteo.com/) (free, no API key). Boca Raton / FAU is the default location.

## Features
- Current conditions, the next 24 hours, and a 7-day forecast
- City search (Open-Meteo geocoding), "use my location", and a 🏠 button to return to Boca
- Light, dark, and system themes (your choice is remembered)
- °F / °C toggle
- A personalized time-of-day greeting
- Refreshes automatically every 10 minutes and whenever you return to the tab
- Responsive layout for phone, tablet, and desktop

## Project layout
```
public/        static site (index.html, styles.css, app.js, favicon.svg)
netlify.toml   Netlify config: publish directory + security headers
```

## Run locally
Serve the `public/` folder with any static server, for example:
```
npx serve public
# or
python3 -m http.server -d public 8080
```

## Deploy to Netlify
There's no build step. Either:
- **Git deploy:** In Netlify, choose *Add new site → Import an existing project* and select this repo. Netlify reads `netlify.toml`, so leave the build command empty. The publish directory is `public`.
- **Drag and drop:** Drag the `public/` folder onto https://app.netlify.com/drop.

Weather data by Open-Meteo.com, licensed CC BY 4.0.
