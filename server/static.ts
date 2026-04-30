import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve favicon.svg with correct content-type explicitly
  app.get("/favicon.svg", (_req, res) => {
    const faviconPath = path.resolve(distPath, "favicon.svg");
    if (fs.existsSync(faviconPath)) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(faviconPath);
    } else {
      res.status(404).end();
    }
  });

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const file = path.basename(filePath);
        const looksHashedAsset = /\.[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|svg|webp|woff2?)$/.test(file);
        if (looksHashedAsset) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (file.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        }
      },
    }),
  );

  // Fall through to index.html for SPA routes only — not for asset file requests
  app.use("/{*path}", (req, res) => {
    if (/\.\w{1,10}$/.test(req.path)) {
      // A file extension was requested but not found — return 404 instead of serving index.html
      return res.status(404).end();
    }
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
