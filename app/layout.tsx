import "./globals.css";

export const metadata = {
  title: "🦈 Feeding Frenzy",
  description: "TikTok Live giveaway — feed the shark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
