import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { httpHarness } from './conformance.spec.ts';
defineConformanceSuite(httpHarness, { duplicateHeaders: true, streaming: true });
