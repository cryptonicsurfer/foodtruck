import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { EnvProvider } from "@/components/env-provider";
import QueryProvider from "@/lib/query-provider";
import { MapsProvider } from "@/lib/maps-context";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Food Truck Booking",
  description: "Book food truck spaces",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <EnvProvider>
          <QueryProvider>
            <AuthProvider>
              <MapsProvider>
                {children}
              </MapsProvider>
            </AuthProvider>
          </QueryProvider>
        </EnvProvider>
        <Toaster />
      </body>
    </html>
  );
}
