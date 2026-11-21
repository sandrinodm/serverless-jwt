import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Issues a short-lived SAN leaf from the existing test CA, including container/proxy DNS names.
 */
export function dockerCertificates(): {
  readonly directory: string;
  readonly cert: Buffer;
  readonly key: Buffer;
  readonly ca: Buffer;
  readonly close: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'serverless-jwt-container-tls-'));
  const fixture = new URL('../../../packages/testkit/fixtures/', import.meta.url);
  copyFileSync(new URL('ca.crt', fixture), join(directory, 'ca.crt'));
  writeFileSync(
    join(directory, 'leaf.ext'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:host.testcontainers.internal,DNS:toxiproxy\nextendedKeyUsage=serverAuth\n',
  );
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=localhost',
        '-keyout',
        join(directory, 'server-key.pem'),
        '-out',
        join(directory, 'server.csr'),
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        join(directory, 'server.csr'),
        '-CA',
        new URL('ca.crt', fixture).pathname,
        '-CAkey',
        new URL('ca-key.pem', fixture).pathname,
        '-set_serial',
        String(Date.now()),
        '-days',
        '2',
        '-extfile',
        join(directory, 'leaf.ext'),
        '-out',
        join(directory, 'server.crt'),
      ],
      { stdio: 'pipe' },
    );
    chmodSync(directory, 0o755);
    chmodSync(join(directory, 'server-key.pem'), 0o644);
    return {
      directory,
      cert: readFileSync(join(directory, 'server.crt')),
      key: readFileSync(join(directory, 'server-key.pem')),
      ca: readFileSync(join(directory, 'ca.crt')),
      close: (): void => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true });
    throw cause;
  }
}
