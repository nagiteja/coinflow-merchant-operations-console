import "./globals.css";
import Script from "next/script";
import WorkerPoller from "@/components/WorkerPoller";
import { SiteHeader } from "@/components/SiteHeader";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ToastProvider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono"
});

export const metadata = {
  title: "Coinflow Merchant Ops Console",
  description: "Simulate payment lifecycle + webhook retries for go-live workflows."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${jetbrainsMono.variable} min-h-screen font-sans antialiased`}>
        <Script id="coinflow-theme-init" strategy="beforeInteractive">
          {`(function(){try{var k='coinflow-theme';var t=localStorage.getItem(k);var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`}
        </Script>
        <WorkerPoller />
        <SiteHeader />
        <ToastProvider>
          <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}

