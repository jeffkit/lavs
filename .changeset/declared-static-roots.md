---
"lavs-runtime": minor
"lavs-types": minor
---

New `view.staticRoots` (issue #12): manifests can declare `[{ mount, path }]` under `view` to serve files OUTSIDE the bundle dir at `/view/:bundle/<mount>/<rel>` (bundle-relative or absolute paths). Each root is lexically bounded by its own resolved base — `..` cannot escape it, roots cannot reach each other, undeclared paths stay bounded by the bundle dir. Same media semantics as #4 (MIME map, Content-Length, Accept-Ranges, single-part Range → 206/416, HEAD). Invalid mount names are rejected at discovery time.
