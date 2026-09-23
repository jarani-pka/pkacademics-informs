const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA_FILE = path.join(__dirname, "data.json");

app.use(cors());
app.use(express.json({ limit: "25mb" }));

// ---------- helpers ----------
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function requireAdmin(req, res, next) {
  const data = readData();
  const pw = req.headers["x-admin-password"];
  if (pw !== data.settings.adminPassword) {
    return res.status(401).json({ error: "Wrong admin password." });
  }
  next();
}

// ---------- UG live updates (sitemap watcher) ----------
// This never copies article text — it only detects new article URLs from UG's own
// sitemap and grabs the page's <title> so we can link out to the original, exactly
// like an "Official Source" card. Nothing is scraped or reproduced beyond that.
async function checkUgFeed() {
  const data = readData();
  if (!data.ugFeed) data.ugFeed = { lastChecked: null, lastError: null, seenUrls: [], items: [] };

  const sitemapUrl = (data.settings.ugSitemapUrl || "https://www.ug.edu.gh/sitemap.xml").trim();
  const pattern = (data.settings.ugNewsUrlPattern || "/news/").trim();

  let xml;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(sitemapUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Sitemap request failed with status ${resp.status}`);
    xml = await resp.text();
  } catch (err) {
    data.ugFeed.lastChecked = new Date().toISOString();
    data.ugFeed.lastError = err.message || String(err);
    writeData(data);
    return { ok: false, error: data.ugFeed.lastError };
  }

  const allUrls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1].trim());
  const newsUrls = pattern ? allUrls.filter(u => u.includes(pattern)) : allUrls;

  const seen = new Set(data.ugFeed.seenUrls || []);
  const freshUrls = newsUrls.filter(u => !seen.has(u)).slice(0, 10); // cap per run, gentle on their server

  const newItems = [];
  for (const url of freshUrls) {
    let title = decodeURIComponent(url.split("/").filter(Boolean).pop() || url)
      .replace(/[-_]/g, " ")
      .replace(/\.\w+$/, "");
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 10000);
      const pageResp = await fetch(url, { signal: controller2.signal });
      clearTimeout(timer2);
      const html = await pageResp.text();
      const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m && m[1]) title = m[1].replace(/\s*[-|]\s*University of Ghana.*$/i, "").trim();
    } catch (e) {
      // couldn't fetch the page title — fall back to the slug-based title above
    }
    newItems.push({ title, url, dateFound: new Date().toISOString() });
    seen.add(url);
  }

  data.ugFeed.items = [...newItems, ...(data.ugFeed.items || [])].slice(0, 30);
  data.ugFeed.seenUrls = Array.from(seen).slice(-500);
  data.ugFeed.lastChecked = new Date().toISOString();
  data.ugFeed.lastError = null;
  writeData(data);
  return { ok: true, newCount: newItems.length, checkedCount: newsUrls.length };
}

// Hit by a free external scheduler (e.g. cron-job.org) on a timer. This both wakes a
// sleeping free-tier Render instance and triggers the actual check. Protected by a
// secret so randoms can't repeatedly trigger scraping of UG's site.
app.get("/api/cron/check-ug-feed", async (req, res) => {
  const data = readData();
  const secret = data.settings.cronSecret;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: "Missing or invalid secret." });
  }
  const result = await checkUgFeed();
  res.json(result);
});

// Manual "Run check now" button in the admin panel.
app.post("/api/admin/ug-feed/check", requireAdmin, async (req, res) => {
  const result = await checkUgFeed();
  res.json(result);
});

// ---------- public read-only endpoints ----------
app.get("/api/data", (req, res) => {
  const data = readData();
  // never expose the raw passwords to the public site, never expose the student accounts list,
  // and never expose ugFeed's internal tracking data (seenUrls, lastError, etc) — only the
  // public-safe list of detected items goes out, as ugUpdates.
  const { settings, studentAccounts, ugFeed, ...rest } = data;
  res.json({
    siteName: settings.siteName,
    tagline: settings.tagline,
    poweredBy: settings.poweredBy,
    ugUpdates: (ugFeed && ugFeed.items) || [],
    ...rest,
  });
});

app.post("/api/verify-gate", (req, res) => {
  const data = readData();
  const ok = req.body.password === data.settings.gatePassword;
  res.json({ ok });
});

// ---------- admin endpoints (all require x-admin-password header) ----------
app.post("/api/admin/verify", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/data", requireAdmin, (req, res) => {
  res.json(readData());
});

// Replace one top-level section: levels, news, halls, regSteps, courseRegSteps, hallRegSteps
app.put("/api/admin/section/:key", requireAdmin, (req, res) => {
  const data = readData();
  const key = req.params.key;
  if (!(key in data)) return res.status(400).json({ error: "Unknown section." });
  data[key] = req.body.value;
  writeData(data);
  res.json({ ok: true });
});

// Change gate or admin password
app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const data = readData();
  data.settings = { ...data.settings, ...req.body };
  writeData(data);
  res.json({ ok: true });
});

// Full backup export (includes everything, for the admin to download)
app.get("/api/admin/backup", requireAdmin, (req, res) => {
  res.json(readData());
});

// Full restore (overwrites everything with an uploaded backup)
app.put("/api/admin/restore", requireAdmin, (req, res) => {
  writeData(req.body);
  res.json({ ok: true });
});

// ---------- PERSONAL TIMETABLES (no password — just a name) ----------

// Save or update someone's personal timetable, identified only by the name they typed
app.put("/api/timetables/:name", (req, res) => {
  const name = req.params.name.trim();
  if (!name) return res.status(400).json({ error: "A name is required." });
  const { level, programme, selectedCourses, timetableSessions } = req.body;
  const data = readData();
  let entry = data.studentAccounts.find(a => a.username.toLowerCase() === name.toLowerCase());
  if (!entry) {
    entry = { username: name, level: null, programme: null, selectedCourses: [], timetableSessions: [] };
    data.studentAccounts.push(entry);
  }
  if (level !== undefined) entry.level = level;
  if (programme !== undefined) entry.programme = programme;
  if (selectedCourses !== undefined) entry.selectedCourses = selectedCourses;
  if (timetableSessions !== undefined) entry.timetableSessions = timetableSessions;
  writeData(data);
  res.json({ ok: true });
});

// Load a saved personal timetable by name (returns 404 if this name hasn't saved one yet)
app.get("/api/timetables/:name", (req, res) => {
  const name = req.params.name.trim();
  const data = readData();
  const entry = data.studentAccounts.find(a => a.username.toLowerCase() === name.toLowerCase());
  if (!entry) return res.status(404).json({ error: "No timetable found for that name yet." });
  res.json(entry);
});

// ---------- ADMIN: view/manage saved personal timetables ----------
app.get("/api/admin/student-accounts", requireAdmin, (req, res) => {
  const data = readData();
  res.json(data.studentAccounts);
});

app.delete("/api/admin/student-accounts/:username", requireAdmin, (req, res) => {
  const data = readData();
  data.studentAccounts = data.studentAccounts.filter(a => a.username !== req.params.username);
  writeData(data);
  res.json({ ok: true });
});

// ---------- static hosting (only expose specific safe files, never data.json) ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});
app.get("/hero.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "hero.jpg"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PKacademics informs running on port ${PORT}`));
