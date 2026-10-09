(() => {
  let context;
  let workletModule;
  let preparation;
  let warmProcessor;
  let warmSource;
  let warmGain;
  let activeSession;

  function getContext() {
    if (!context || context.state === 'closed') {
      context = new AudioContext({ sampleRate: 44100 });
      workletModule = null;
      warmProcessor = null;
      warmSource = null;
      warmGain = null;
    }
    return context;
  }

  async function loadWorklet(audioContext) {
    if (!workletModule) {
      workletModule = audioContext.audioWorklet.addModule(
        new URL('noise/rnnoise-worklet.js', document.baseURI),
      );
    }
    await workletModule;
  }

  async function prepare() {
    if (warmProcessor) return true;
    if (preparation) return preparation;

    preparation = (async () => {
      const audioContext = getContext();
      await loadWorklet(audioContext);
      if (context !== audioContext || audioContext.state === 'closed') {
        return false;
      }
      if (warmProcessor) return true;

      const processor = new AudioWorkletNode(audioContext, 'boomroom-rnnoise', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const processorReady = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('RNNoise processor initialization timed out'));
        }, 5000);
        processor.port.onmessage = ({ data }) => {
          if (data === 'ready') {
            clearTimeout(timeout);
            resolve();
          }
        };
        processor.addEventListener('processorerror', () => {
          clearTimeout(timeout);
          reject(new Error('RNNoise processor failed to initialize'));
        }, { once: true });
      });
      const silence = audioContext.createConstantSource();
      silence.offset.value = 0;
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      silence.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);
      silence.start();
      try {
        await processorReady;
      } catch (error) {
        try { silence.stop(); } catch (_) {}
        try { silence.disconnect(); } catch (_) {}
        try { processor.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        throw error;
      }

      // The context may stay suspended until a user gesture. The processor is
      // still constructed now, which downloads/compiles the worklet and WASM
      // without opening or transmitting microphone audio.
      audioContext.resume().catch(() => {});

      warmProcessor = processor;
      warmSource = silence;
      warmGain = gain;
      return true;
    })();
    try {
      return await preparation;
    } finally {
      preparation = null;
    }
  }

  window.BoomRoomNoiseSuppression = {
    async prepare() {
      return prepare();
    },
    async create(rawStream) {
      const prepared = await prepare();
      if (!prepared || !warmProcessor) {
        throw new Error('RNNoise worklet is not available');
      }
      const audioContext = getContext();
      await audioContext.resume();

      if (activeSession) {
        throw new Error('RNNoise already has an active microphone session');
      }

      try { warmSource?.stop(); } catch (_) {}
      try { warmSource?.disconnect(); } catch (_) {}
      warmSource = null;

      const source = audioContext.createMediaStreamSource(rawStream);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(warmProcessor);
      warmProcessor.connect(destination);
      const session = {
        stream: destination.stream,
        source,
        processor: warmProcessor,
        destination,
        context: audioContext,
      };
      activeSession = session;
      return session;
    },
    async dispose(session) {
      if (activeSession !== session) return;
      activeSession = null;
      try { session.processor.port.postMessage('dispose'); } catch (_) {}
      try { session.source.disconnect(); } catch (_) {}
      try { session.processor.disconnect(); } catch (_) {}
      try { session.destination.disconnect(); } catch (_) {}
      try { warmGain?.disconnect(); } catch (_) {}
      warmProcessor = null;
      warmGain = null;
      warmSource = null;
    },
    async disposePreparation() {
      const current = context;
      if (activeSession) return;
      context = null;
      workletModule = null;
      preparation = null;
      warmProcessor = null;
      warmSource = null;
      warmGain = null;
      if (current && current.state !== 'closed') {
        await current.close().catch(() => {});
      }
    },
  };
})();
