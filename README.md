# ryduzz

[![GitHub Pages](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-blue?logo=github)](https://ryderjt.github.io/ryduzz/)
[![Last Commit](https://img.shields.io/github/last-commit/ryderjt/ryduzz?logo=github)](https://github.com/ryderjt/ryduzz/commits)
[![Repo Size](https://img.shields.io/github/repo-size/ryderjt/ryduzz)](https://github.com/ryderjt/ryduzz)

A minimalist portfolio website showcasing my work.

## Development

This repository hosts a static site served through GitHub Pages. Edit `index.html` and open it in your browser to preview changes.

## Owner dashboard

The `/admin.html` page provides a password-gated dashboard for viewing the lightweight analytics stored in your browser and clearing/exporting them. The tracking is entirely client-side (per device). The default password is `ryduzz-analytics-2024`. Generate a new SHA-256 hash and replace the `PASSWORD_HASH` constant inside `admin.html` to change it.

## Deployment

Push to the `main` branch and GitHub Pages will rebuild the site automatically.

