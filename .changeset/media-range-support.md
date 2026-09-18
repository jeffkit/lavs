---
"lavs-runtime": minor
---

Host media support in `/view/:bundle/*`: `Range` requests (RFC 7233 single-part → 206/416), `Content-Length`, `Accept-Ranges: bytes`, `HEAD`, and extended MIME map (mp4/mov/webm/mp3/m4a/wav/jpg/jpeg/webp/gif). Enables `<video>` seek/duration for local media in bundle views. Lexical path containment kept intentionally — symlinks to media outside the bundle dir still work.
