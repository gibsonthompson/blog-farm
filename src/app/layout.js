export const metadata = {
  title: 'Blog Automation | CallBird AI',
  description: 'Automated blog post generation and publishing pipeline',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
