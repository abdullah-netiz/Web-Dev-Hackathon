import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Baton",
    short_name: "Baton",
    description: "The CRM where every lead has one owner, a visible clock, and an automatic hand-off.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f9f8",
    theme_color: "#06525c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
