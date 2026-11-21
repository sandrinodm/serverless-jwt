import type { StartHandler } from '@solidjs/start/server';

import { createHandler, StartServer } from '@solidjs/start/server';

const handler: StartHandler = createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html>
        <head>{assets}</head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));

export default handler;
