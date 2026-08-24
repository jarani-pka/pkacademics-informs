# PKacademics informs

A student portal for University of Ghana students, with a separate admin panel
for editing everything (timetable, exams, past questions, news, halls) without
touching code.

## Structure
- `server.js` — backend that serves both sites and the API
- `public/` — the public-facing student site
- `admin/` — the admin panel (visit `/admin` once deployed)
- `data.json` — all site content, editable live from the admin panel

## Run locally
```
npm install
npm start
```
Then open http://localhost:3000 (public site) and http://localhost:3000/admin (admin panel).

## Passwords
Default visitor password and admin password are both set in `data.json` under
`settings`. Change either one anytime from the admin panel's Settings tab —
no code editing needed.
