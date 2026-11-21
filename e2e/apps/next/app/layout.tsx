import type { ReactElement, ReactNode } from 'react';

/**
 * Minimal server-rendered layout keeps the bearer API example independent of browser sessions.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
