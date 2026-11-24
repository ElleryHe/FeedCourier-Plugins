# 0.3.1

- Initial release of the official **Bark Push** single-file JS channel plugin (`Plugin API v1`).
- Formats iOS/macOS notifications in FeedCourier's **Telegram Compact Card (摘要模式)** style: concise headline, clean summary with duplicate-title suppression, compact editorial footer (`— Source · Author · YYYY-MM-DD HH:MM`), tap-to-open article URL, and optional HTTPS feed favicon.
- Supports official `https://api.day.app` as well as self-hosted Bark servers with optional HTTP Basic Auth, interruption levels (`active`, `timeSensitive`, `passive`, `critical`), custom notification group, and custom sound.
