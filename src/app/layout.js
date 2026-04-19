export const metadata = {
  title: 'Blog Automation | Content Pipeline',
  description: 'Multi-tenant automated blog post generation and publishing pipeline',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}