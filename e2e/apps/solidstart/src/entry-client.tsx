import { mount, StartClient } from '@solidjs/start/client';

const root = document.getElementById('app');
if (!root) {
  throw new Error('SolidStart application root is missing');
}

mount(() => <StartClient />, root);
