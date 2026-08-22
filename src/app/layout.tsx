import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LangProvider } from "@/lib/i18n/LangContext";
import { CurrencyProvider } from "@/lib/currency/CurrencyContext";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";
import BrandThemeSync from "@/components/BrandThemeSync";
import DialogProvider from "@/components/DialogProvider";
import { BRAND_COLOR_INIT_SCRIPT } from "@/lib/brandColor";

export const metadata: Metadata = {
  title: "ProfitSnap",
  description: "Track sales, stock, and profit for your shop.",
  manifest: "/manifest.json",
  icons: {
    // Regular browser tab / bookmark icons — full-bleed transparent PNGs,
    // the browser handles any shaping itself.
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS home-screen icon — Safari applies its own rounded-corner mask
    // on top of this, so it must stay a plain full-bleed square, never
    // pre-rounded.
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#11131a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the tenant's cached brand color before hydration, so
            returning visitors don't see a flash of the default purple. */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_COLOR_INIT_SCRIPT }} />
      </head>
      <body className="h-full bg-[#11131a] font-sans">
        <LangProvider>
          <CurrencyProvider>
            <ToastProvider>
              <BrandThemeSync>
                <DialogProvider>
                  <AppShell>{children}</AppShell>
                </DialogProvider>
              </BrandThemeSync>
            </ToastProvider>
          </CurrencyProvider>
        </LangProvider>
      </body>
    </html>
  );
}
