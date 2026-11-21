import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3';
import { H3, toNodeHandler } from 'h3-v2';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { expect, it } from 'vite-plus/test';

import { listen, wireStatus } from '../../testkit/src/conformance/node-wire.ts';
import { jwtMiddleware as webMiddleware } from './h3-v2.ts';
import { jwtMiddleware as nodeMiddleware } from './index.ts';

for (const major of [1, 2]) {
  it(
    'matches actual h3 v' + major + ' routes before encoded paths can bypass protection',
    async () => {
      const earlyNodeRoutes =
        major === 1 && createRequire(import.meta.url)('h3/package.json').version === '1.15.0';
      const paths = ['/protected', '/api', '/api/me', '/café'];
      const punctuation = [':', '@', ';', '+', '$', ',', '&', '='];
      paths.push(...punctuation.map((value) => '/literal' + value + 'name'));
      const options = {
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: ['/protected', '/api/**', '/café', ...paths.slice(4)],
      };
      let entered = 0;
      const handler = (): string => {
        entered++;
        return 'protected handler';
      };
      const app = createApp();
      const web = new H3({ silent: true });
      const router = createRouter();
      const publicApp = createApp();
      const publicWeb = new H3({ silent: true });
      const publicRouter = createRouter();
      if (major === 1) {
        app.use(nodeMiddleware(options));
        for (const path of paths) {
          router.get(path, defineEventHandler(handler));
          publicRouter.get(
            path,
            defineEventHandler(() => 'native route'),
          );
        }

        app.use(router);
        publicApp.use(publicRouter);
      } else {
        web.use(webMiddleware(options));
        for (const path of paths) {
          web.get(path, handler);
          publicWeb.get(path, () => 'native route');
        }
      }

      await using server = await listen(
        createServer(major === 1 ? toNodeListener(app) : toNodeHandler(web)),
      );
      await using native = await listen(
        createServer(major === 1 ? toNodeListener(publicApp) : toNodeHandler(publicWeb)),
      );
      for (const path of [
        '/protected',
        '/%70rotected',
        '/protected/',
        '/protected?ignored',
        '/api',
        '/api/me',
        '/caf%C3%A9',
        ...punctuation.map((value) => '/literal' + '%' + value.charCodeAt(0).toString(16) + 'name'),
        ...(major === 1
          ? ['/protected%3Fignored', '/api%3fignored']
          : [
              '/public/%2e%2e/protected',
              '/public\\..\\protected',
              'http://host.example/protected',
              'http://host.example/%70rotected',
            ]),
      ]) {
        // The actual minimum predates h3 v1's decoding; the guard still rejects every spelling.
        expect(await wireStatus(native.port, [], path), path).toBe(
          earlyNodeRoutes && path.includes('%') ? 404 : 200,
        );
        expect(await wireStatus(server.port, [], path), path).toBe(401);
      }

      expect(entered).toBe(0);
      for (const path of [
        '/api%2Fme',
        '/api%2fme',
        '/api%5Cme',
        '/%2570rotected',
        '/protected%253Fignored',
        '//protected',
        ...(major === 2 ? ['/protected%3Fignored'] : []),
      ]) {
        expect(await wireStatus(server.port, [], path), path).toBe(404);
      }

      for (const path of ['/bad%', '/bad%q0', '/bad%C0%AF']) {
        expect(await wireStatus(server.port, [], path), path).toBe(400);
      }

      expect(entered).toBe(0);
    },
  );
}
