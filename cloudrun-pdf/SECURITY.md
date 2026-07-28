# Chromium runtime boundary

The PDF worker renders only server-built, self-contained HTML. It runs as the
non-root `pptruser`, disables JavaScript per page, and blocks every navigation
or subresource request except `about:blank` and base64 PNG/JPEG content. User
input cannot supply HTTP(S), file, blob, WebSocket, nested `data:` documents, or
other browser URLs.

The container currently passes Chromium `--no-sandbox` because Cloud Run's
gVisor runtime blocks the namespace operations required by Chromium's native
sandbox. This exception is acceptable only while all of these controls remain:

- Cloud Run's managed gVisor isolation is enabled.
- The image and process remain non-root.
- No privileged container capabilities are added.
- JavaScript stays disabled and external requests stay blocked before
  `page.setContent`.
- The PDF service remains private and accepts only verified Pub/Sub identity.

If the deployment runtime gains supported user namespaces, remove
`--no-sandbox` and `--disable-setuid-sandbox` and verify the image in CI before
rollout.
