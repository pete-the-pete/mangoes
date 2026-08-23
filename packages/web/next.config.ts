import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next blocks cross-origin requests to dev-only assets, so reaching `next dev`
  // over Tailscale (https://<machine>.<tailnet>.ts.net) 403s without this.
  //
  // `**`, not `*`: Next's matcher gives `*` exactly one label, and a MagicDNS
  // name has two before the suffix (lawljegrens-m1.tail73b073.ts.net), so
  // `*.ts.net` silently fails to match. Same reason Next's own built-in default
  // is `**.localhost`.
  //
  // Wildcarded rather than pinned to one machine: .ts.net names only resolve and
  // route inside your own tailnet, and this is dev-only — no effect on a
  // production build.
  allowedDevOrigins: ["**.ts.net"],
};

export default nextConfig;
