'use strict';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REFRESH_MS = 10 * 60 * 1000;

const HOME = {
  name: 'Boca Raton',
  sub: 'Florida Atlantic University · Florida, United States',
  latitude: 26.3705,
  longitude: -80.1024,
};

// WMO weather interpretation codes -> [description, day icon, night icon]
const WMO = {
  0: ['Clear sky', '☀️', '🌙'],
  1: ['Mainly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Heavy freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Heavy freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Light showers', '🌦️', '🌧️'],
  81: ['Showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Heavy snow showers', '❄️', '❄️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm with hail', '⛈️', '⛈️'],
  99: ['Severe thunderstorm with hail', '⛈️', '⛈️'],
};

const $ = (id) => document.getElementById(id);

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const state = {
  location: { ...HOME },
  unit: store.get('unit') === 'celsius' ? 'celsius' : 'fahrenheit',
  data: null,
  refreshTimer: null,
  requestId: 0,
};

/* ---------------- Theme ---------------- */

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') {
    root.setAttribute('data-theme', choice);
    store.set('theme', choice);
  } else {
    choice = 'system';
    root.removeAttribute('data-theme');
    store.remove('theme');
  }
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.themeChoice === choice));
  });
  updateThemeColor();
}

function updateThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

function initTheme() {
  applyTheme(store.get('theme') || 'system');
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
  });
  systemDark.addEventListener('change', updateThemeColor);
}

/* ---------------- Units ---------------- */

function initUnits() {
  const buttons = document.querySelectorAll('[data-unit]');
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unit === state.unit)));
  sync();
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.unit === btn.dataset.unit) return;
      state.unit = btn.dataset.unit;
      store.set('unit', state.unit);
      sync();
      loadWeather();
    });
  });
}

/* ---------------- Greeting ---------------- */

function renderGreeting() {
  const h = new Date().getHours();
  let part = 'evening';
  let emoji = '🌆';
  if (h >= 5 && h < 12) { part = 'morning'; emoji = '🌅'; }
  else if (h >= 12 && h < 17) { part = 'afternoon'; emoji = '☀️'; }
  else if (h >= 21 || h < 5) { part = 'night'; emoji = '🌙'; }

  $('greeting-title').textContent = part === 'night'
    ? `Hey there, Tushara ${emoji}`
    : `Good ${part}, Tushara ${emoji}`;

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('greeting-sub').textContent = `Welcome back! Here's your weather for ${today}.`;
}

/* ---------------- Formatting helpers ---------------- */

const tempSymbol = () => (state.unit === 'celsius' ? '°C' : '°F');
const round = (n) => (n == null || Number.isNaN(n) ? '--' : Math.round(n));
const deg = (n) => `${round(n)}°`;

function describe(code, isDay = 1) {
  const entry = WMO[code] || ['Unknown', '🌡️', '🌡️'];
  return { text: entry[0], icon: isDay ? entry[1] : entry[2] };
}

function compass(degrees) {
  if (degrees == null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

// Open-Meteo returns local ISO strings (no offset) when timezone=auto,
// so parse the parts directly instead of letting Date shift them.
function parseLocal(iso) {
  const [d, t = '00:00'] = iso.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, day, hh, mm);
}

const fmtHour = (iso) => parseLocal(iso).toLocaleTimeString(undefined, { hour: 'numeric' });
const fmtTime = (iso) => parseLocal(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function uvLabel(uv) {
  if (uv == null) return '--';
  const v = Math.round(uv);
  const level = v < 3 ? 'Low' : v < 6 ? 'Moderate' : v < 8 ? 'High' : v < 11 ? 'Very high' : 'Extreme';
  return `${v} · ${level}`;
}

/* ---------------- Status ---------------- */

function setStatus(message, isError = false) {
  const el = $('status');
  if (!message) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('error', isError);
}

/* ---------------- Weather ---------------- */

async function loadWeather() {
  const { latitude, longitude } = state.location;
  const requestId = ++state.requestId;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
      'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    ].join(','),
    hourly: ['temperature_2m', 'precipitation_probability', 'weather_code', 'is_day'].join(','),
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'sunrise', 'sunset', 'uv_index_max', 'precipitation_probability_max',
    ].join(','),
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === 'celsius' ? 'kmh' : 'mph',
    precipitation_unit: state.unit === 'celsius' ? 'mm' : 'inch',
    timezone: 'auto',
    forecast_days: '7',
  });

  $('content').setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`${FORECAST_URL}?${params}`);
    if (!res.ok) throw new Error(`Weather service responded with ${res.status}`);
    const data = await res.json();
    if (requestId !== state.requestId) return; // a newer request superseded this one
    state.data = data;
    render(data);
    setStatus('');
  } catch (err) {
    if (requestId !== state.requestId) return;
    console.error(err);
    setStatus(
      state.data
        ? 'Could not refresh the weather right now. Showing the last update.'
        : 'Could not load the weather. Check your connection and try again.',
      true,
    );
  } finally {
    if (requestId === state.requestId) $('content').setAttribute('aria-busy', 'false');
  }
  scheduleRefresh();
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(loadWeather, REFRESH_MS);
}

function render(data) {
  const { current, hourly, daily, current_units: cu } = data;
  const { text, icon } = describe(current.weather_code, current.is_day);

  $('loc-name').textContent = state.location.name;
  $('loc-sub').textContent = state.location.sub || '';
  $('updated').textContent = `Updated ${fmtTime(current.time)} local time`;

  $('current-icon').textContent = icon;
  $('current-temp').textContent = `${round(current.temperature_2m)}${tempSymbol()}`;
  $('current-temp').classList.remove('skeleton');
  $('current-desc').textContent = text;
  $('current-hilo').textContent =
    `H ${deg(daily.temperature_2m_max[0])} · L ${deg(daily.temperature_2m_min[0])} · Feels like ${deg(current.apparent_temperature)}`;

  const precipUnit = cu.precipitation === 'inch' ? 'in' : cu.precipitation;
  const windUnit = cu.wind_speed_10m === 'mp/h' ? 'mph' : cu.wind_speed_10m;
  const stats = [
    ['Humidity', `${round(current.relative_humidity_2m)}%`],
    ['Wind', `${round(current.wind_speed_10m)} ${windUnit} ${compass(current.wind_direction_10m)}`],
    ['Gusts', `${round(current.wind_gusts_10m)} ${windUnit}`],
    ['UV index', uvLabel(daily.uv_index_max[0])],
    ['Rain chance', `${round(daily.precipitation_probability_max[0])}%`],
    ['Precipitation', `${current.precipitation ?? 0} ${precipUnit}`],
    ['Cloud cover', `${round(current.cloud_cover)}%`],
    ['Pressure', `${round(current.pressure_msl)} hPa`],
    ['Sunrise / Sunset', `${fmtTime(daily.sunrise[0])} / ${fmtTime(daily.sunset[0])}`],
  ];
  $('stats').replaceChildren(...stats.map(([label, value]) => {
    const wrap = document.createElement('div');
    wrap.className = 'stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    return wrap;
  }));

  renderHourly(current, hourly);
  renderDaily(daily);
}

function renderHourly(current, hourly) {
  const nowKey = current.time.slice(0, 13); // "YYYY-MM-DDTHH"
  let start = hourly.time.findIndex((t) => t.slice(0, 13) >= nowKey);
  if (start < 0) start = 0;

  const items = [];
  for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
    const { icon, text } = describe(hourly.weather_code[i], hourly.is_day[i]);
    const pop = hourly.precipitation_probability[i];
    const el = document.createElement('div');
    el.className = i === start ? 'hour now' : 'hour';
    el.innerHTML = `
      <div class="t"></div>
      <div class="i" role="img"></div>
      <div class="v"></div>
      <div class="p"></div>`;
    el.querySelector('.t').textContent = i === start ? 'Now' : fmtHour(hourly.time[i]);
    el.querySelector('.i').textContent = icon;
    el.querySelector('.i').setAttribute('aria-label', text);
    el.querySelector('.v').textContent = deg(hourly.temperature_2m[i]);
    el.querySelector('.p').textContent = pop ? `💧${pop}%` : '';
    items.push(el);
  }
  $('hourly').replaceChildren(...items);
  $('hourly').scrollLeft = 0;
}

function renderDaily(daily) {
  const lows = daily.temperature_2m_min;
  const highs = daily.temperature_2m_max;
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(max - min, 1);

  const items = daily.time.map((iso, i) => {
    const { icon, text } = describe(daily.weather_code[i], 1);
    const name = i === 0 ? 'Today' : parseLocal(iso).toLocaleDateString(undefined, { weekday: 'short' });
    const pop = daily.precipitation_probability_max[i];
    const left = ((lows[i] - min) / span) * 100;
    const width = Math.max(((highs[i] - lows[i]) / span) * 100, 4);

    const li = document.createElement('li');
    li.className = 'day';
    li.innerHTML = `
      <span class="name"></span>
      <span class="icon" role="img"></span>
      <span class="rain"></span>
      <span class="range">
        <span class="lo"></span>
        <span class="bar"><span></span></span>
        <span class="hi"></span>
      </span>`;
    li.querySelector('.name').textContent = name;
    li.querySelector('.icon').textContent = icon;
    li.querySelector('.icon').setAttribute('aria-label', text);
    li.querySelector('.rain').textContent = pop ? `💧${pop}%` : '';
    li.querySelector('.lo').textContent = deg(lows[i]);
    li.querySelector('.hi').textContent = deg(highs[i]);
    const fill = li.querySelector('.bar span');
    fill.style.left = `${left}%`;
    fill.style.width = `${width}%`;
    return li;
  });
  $('daily').replaceChildren(...items);
}

/* ---------------- Location search ---------------- */

function setLocation(loc) {
  state.location = loc;
  $('loc-name').textContent = loc.name;
  $('loc-sub').textContent = loc.sub || '';
  loadWeather();
}

function initSearch() {
  const form = $('search-form');
  const input = $('search-input');
  const list = $('search-results');
  let results = [];
  let active = -1;
  let debounce;
  let searchId = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const choose = (r) => {
    const sub = [r.admin1, r.country].filter(Boolean).join(', ');
    setLocation({ name: r.name, sub, latitude: r.latitude, longitude: r.longitude });
    input.value = '';
    close();
    input.blur();
  };

  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
  };

  const show = (items) => {
    results = items;
    active = -1;
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'No matching places found';
      li.className = 'muted';
      list.replaceChildren(li);
    } else {
      list.replaceChildren(...items.map((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `result-${i}`;
        li.textContent = r.name;
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = [r.admin1, r.country].filter(Boolean).join(', ');
        li.append(sub);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(r); });
        return li;
      }));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const search = async (q) => {
    const id = ++searchId;
    try {
      const params = new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
      const res = await fetch(`${GEOCODE_URL}?${params}`);
      if (!res.ok) throw new Error(`Geocoding responded with ${res.status}`);
      const data = await res.json();
      if (id === searchId) show(data.results || []);
    } catch (err) {
      console.error(err);
      if (id === searchId) setStatus('City search is unavailable right now.', true);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) { searchId++; close(); return; }
    debounce = setTimeout(() => search(q), 250);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + results.length) % results.length); }
    else if (e.key === 'Escape') { close(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!list.hidden && results.length) choose(results[Math.max(active, 0)]);
  });

  input.addEventListener('blur', () => setTimeout(close, 100));

  $('home-btn').addEventListener('click', () => setLocation({ ...HOME }));

  $('locate-btn').addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      setStatus('Your browser does not support location access.', true);
      return;
    }
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus('');
        setLocation({
          name: 'Your location',
          sub: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => setStatus('Could not get your location. Showing the current city instead.', true),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/* ---------------- Boot ---------------- */

initTheme();
initUnits();
renderGreeting();
initSearch();
loadWeather();

// Refresh when the tab comes back into view after a while.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    renderGreeting();
    loadWeather();
  }
});
