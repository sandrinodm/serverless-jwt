import type { ReactElement } from 'react';

/**
 * Public browser landing page does not require bearer credentials.
 */
export default function Home(): ReactElement {
  return <main>Use a bearer access token for the API.</main>;
}
