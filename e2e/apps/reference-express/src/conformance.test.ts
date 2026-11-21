import { defineConformanceSuite } from '../../../../packages/testkit/src/conformance/suite.ts';
import { httpHarness } from './http-harness.ts';

defineConformanceSuite(httpHarness, { duplicateHeaders: true, streaming: true });
