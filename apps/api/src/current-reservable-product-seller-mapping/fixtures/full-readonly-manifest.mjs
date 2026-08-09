import { gunzipSync } from 'node:zlib';
import payload01 from './manifest-payload-01.mjs';
import payload02 from './manifest-payload-02.mjs';
import payload03 from './manifest-payload-03.mjs';
import payload04 from './manifest-payload-04.mjs';
import payload05 from './manifest-payload-05.mjs';
import payload06 from './manifest-payload-06.mjs';

const encoded = [payload01, payload02, payload03, payload04, payload05, payload06].join('');
export const fullReadonlyManifest = JSON.parse(
  gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'),
);
export default fullReadonlyManifest;
