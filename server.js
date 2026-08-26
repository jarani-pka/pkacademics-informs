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

// ---------- STUDENT ACCOUNTS ----------

// Student requests an account (public) — goes into a pending queue for admin approval
app.post("/api/student/request", (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) return res.status(400).json({ error: "Username and phone number are required." });
  const data = readData();
  if (data.studentAccounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already taken or pending." });
  }
  data.studentAccounts.push({
    username,
    phone,
    password: null,
    status: "pending",
    requestedAt: new Date().toISOString(),
    level: null,
    programme: null,
    selectedCourses: [],
    timetableSessions: [],
    academicYear: null,
    semester: null,
  });
  writeData(data);
  res.json({ ok: true });
});

// Student logs in with username + password (set by admin)
app.post("/api/student/login", (req, res) => {
  const { username, password } = req.body;
  const data = readData();
  const account = data.studentAccounts.find(a => a.username.toLowerCase() === (username || "").toLowerCase());
  if (!account || account.status !== "approved" || account.password !== password) {
    return res.status(401).json({ error: "Incorrect username or password, or your account isn't approved yet." });
  }
  const { password: _pw, ...safe } = account;
  res.json({ ok: true, account: safe });
});

function requireStudent(req, res, next) {
  const { username, password } = req.body;
  const data = readData();
  const account = data.studentAccounts.find(a => a.username.toLowerCase() === (username || "").toLowerCase());
  if (!account || account.status !== "approved" || account.password !== password) {
    return res.status(401).json({ error: "Not logged in." });
  }
  req.studentAccount = account;
  req.fullData = data;
  next();
}

// Student saves/updates their personal timetable
app.put("/api/student/timetable", requireStudent, (req, res) => {
  const { level, programme, selectedCourses, timetableSessions, academicYear, semester } = req.body;
  const account = req.studentAccount;
  if (level !== undefined) account.level = level;
  if (programme !== undefined) account.programme = programme;
  if (selectedCourses !== undefined) account.selectedCourses = selectedCourses;
  if (timetableSessions !== undefined) account.timetableSessions = timetableSessions;
  if (academicYear !== undefined) account.academicYear = academicYear;
  if (semester !== undefined) account.semester = semester;
  writeData(req.fullData);
  res.json({ ok: true });
});

// ---------- ADMIN: manage student accounts ----------
app.get("/api/admin/student-accounts", requireAdmin, (req, res) => {
  const data = readData();
  res.json(data.studentAccounts);
});

// Approve a pending request and set their password
app.put("/api/admin/student-accounts/:username/approve", requireAdmin, (req, res) => {
  const data = readData();
  const account = data.studentAccounts.find(a => a.username === req.params.username);
  if (!account) return res.status(404).json({ error: "Account not found." });
  account.status = "approved";
  account.password = req.body.password;
  account.approvedAt = new Date().toISOString();
  writeData(data);
  res.json({ ok: true });
});

// Reset an existing account's password
app.put("/api/admin/student-accounts/:username/reset-password", requireAdmin, (req, res) => {
  const data = readData();
  const account = data.studentAccounts.find(a => a.username === req.params.username);
  if (!account) return res.status(404).json({ error: "Account not found." });
  account.password = req.body.password;
  writeData(data);
  res.json({ ok: true });
});

// Delete an account
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
