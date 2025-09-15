# ryduzz

[![GitHub Pages](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-blue?logo=github)](https://ryderjt.github.io/ryduzz/)
[![Last Commit](https://img.shields.io/github/last-commit/ryderjt/ryduzz?logo=github)](https://github.com/ryderjt/ryduzz/commits)
[![Repo Size](https://img.shields.io/github/repo-size/ryderjt/ryduzz)](https://github.com/ryderjt/ryduzz)

A minimalist portfolio website showcasing my work.

## Development

This repository hosts a static site served through GitHub Pages. Edit `index.html` and open it in your browser to preview changes.

## Analytics Dashboard

Visit and click events are streamed to a lightweight Node.js service (`api/server.js`) that persists aggregated analytics in `api/data/analytics.json`. Start the service locally with:

```bash
node api/server.js
```

Set `PORT`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, or `ALLOWED_ORIGINS` environment variables as needed. By default the API listens on port `3000` and expects the admin password `ra1ph_` (or its SHA-256 hash).

The front-end helper `analytics.js` sends data to the API and can be configured to point at a remote host before it loads:

```html
<script>
  window.SITE_ANALYTICS_CONFIG = { baseUrl: 'https://your-analytics-host.example.com' };
</script>
<script src="analytics.js"></script>
```

The password-protected admin panel at [`/admin.html`](admin.html) pulls live data from the API using the same password. Clearing the dashboard now wipes the shared server-side record for all visitors.

## Deployment

Push to the `main` branch and GitHub Pages will rebuild the site automatically.

