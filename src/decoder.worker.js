import { decodeRecording, readWav } from './core/modem.js';
self.onmessage = event => {
  try {
    const result = decodeRecording(readWav(event.data), progress => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'result', ...result });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
