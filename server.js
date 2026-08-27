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

// ---------- public read-only endpoints ----------
app.get("/api/data", (req, res) => {
  const data = readData();
  // never expose the raw passwords to the public site, and never expose the student accounts list
  const { settings, studentAccounts, ...rest } = data;
  res.json({
    siteName: settings.siteName,
    tagline: settings.tagline,
    poweredBy: settings.poweredBy,
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
