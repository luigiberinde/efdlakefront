export const metadata = { title: "Lakefront Shift Swap", robots: { index: false, follow: false } };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head><meta name="robots" content="noindex, nofollow" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style={{ margin: 0, padding: 0, background: "linear-gradient(180deg,#f7f8fb 0%,#fff 28%)", minHeight: "100vh" }}>{children}</body>
    </html>
  );
}
