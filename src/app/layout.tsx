import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentUser } from "@/lib/session";
import { settings } from "@/lib/config";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "HomePlace",
  description: "Self-hosted dashboard and monitoring panel for your home server.",
  // Browser and installed-app icons use the same mark as the native apps.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "HomePlace", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page draw into the rounded corners and around the home indicator,
  // which is also what makes env(safe-area-inset-*) report real numbers — the
  // bottom navigation positions itself with them.
  viewportFit: "cover",
  // Both are declared so the browser chrome follows whichever theme is active;
  // the page itself picks its palette from CSS variables.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f13" },
  ],
};

/**
 * Theme and language are attributes on <html>, resolved on the server from the
 * signed-in account. Rendering them server-side is what avoids the flash of the
 * wrong theme: the first painted frame is already correct, with no script
 * involved.
 *
 * theme = "system" means no data-theme attribute at all, which hands the
 * decision to prefers-color-scheme.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const theme = user?.theme ?? "system";
  const accent = user?.accent ?? "default";
  const locale = user?.locale ?? settings.defaultLocale();

  return (
    <html
      lang={locale}
      {...(theme === "light" || theme === "dark" ? { "data-theme": theme } : {})}
      {...(accent && accent !== "default" ? { "data-accent": accent } : {})}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-bg text-text">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
