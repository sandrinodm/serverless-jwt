import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Regenerates synthetic signing keys and the local trust anchor; never use these public fixtures
 * outside tests. OpenSSL signs X.509 certificates because node:crypto exposes no certificate
 * issuer.
 */
const directory = resolve('packages/testkit/fixtures');
for (const bits of [1024, 2048]) {
  const pair = generateKeyPairSync('rsa', { modulusLength: bits });
  writeFileSync(
    `${directory}/rsa-${bits}.pem`,
    pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
  );
  execFileSync('openssl', [
    'req',
    '-new',
    '-x509',
    '-key',
    `${directory}/rsa-${bits}.pem`,
    '-out',
    `${directory}/rsa-${bits}.crt`,
    '-days',
    '3650',
    '-subj',
    '/CN=synthetic signing fixture',
  ]);
}

/**
 * Public EC certificate fixtures prove x5c import across all allowed ECDSA curves.
 */
using ecTemporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-ec-fixtures-'));
for (const [bits, namedCurve] of [
  [256, 'prime256v1'],
  [384, 'secp384r1'],
  [521, 'secp521r1'],
]) {
  const ec = generateKeyPairSync('ec', { namedCurve });
  const keyFile = join(ecTemporary.path, `ec-${bits}.pem`);
  writeFileSync(keyFile, ec.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  execFileSync('openssl', [
    'req',
    '-new',
    '-x509',
    '-key',
    keyFile,
    '-out',
    `${directory}/ec-p${bits}.crt`,
    '-days',
    '3650',
    '-subj',
    `/CN=synthetic ec p${bits} fixture`,
  ]);
}

/**
 * Generates the local test certificate authority key without storing a production credential.
 */
const ca = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(`${directory}/ca-key.pem`, ca.privateKey.export({ format: 'pem', type: 'pkcs8' }));
execFileSync('openssl', [
  'req',
  '-new',
  '-x509',
  '-key',
  `${directory}/ca-key.pem`,
  '-out',
  `${directory}/ca.crt`,
  '-days',
  '3650',
  '-subj',
  '/CN=serverless-jwt test CA',
  '-addext',
  'basicConstraints=critical,CA:TRUE',
]);
/**
 * Generates the HTTPS fixture server key signed by the local test authority.
 */
const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(
  `${directory}/server-key.pem`,
  server.privateKey.export({ format: 'pem', type: 'pkcs8' }),
);
execFileSync('openssl', [
  'req',
  '-new',
  '-key',
  `${directory}/server-key.pem`,
  '-out',
  `${directory}/server.csr`,
  '-subj',
  '/CN=localhost',
]);
writeFileSync(
  `${directory}/server.ext`,
  'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n',
);
execFileSync('openssl', [
  'x509',
  '-req',
  '-in',
  `${directory}/server.csr`,
  '-CA',
  `${directory}/ca.crt`,
  '-CAkey',
  `${directory}/ca-key.pem`,
  '-set_serial',
  '2',
  '-out',
  `${directory}/server.crt`,
  '-days',
  '3650',
  '-extfile',
  `${directory}/server.ext`,
]);

writeFileSync(`${directory}/invalid-cert.txt`, 'not a certificate');
