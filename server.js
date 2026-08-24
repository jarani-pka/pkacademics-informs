const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA_FILE = path.join(__dirname, "data.json");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
  // never expose the raw passwords to the public site
  const { settings, ...rest } = data;
  res.json({
    siteName: settings.siteName,
    tagline: settings.tagline,
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
