(() => {
  window.BoomRoomNoiseSuppression = {
    async create(rawStream) {
      const context = new AudioContext({ sampleRate: 44100 });
      let source;
      let processor;
      try {
        await context.audioWorklet.addModule(
          new URL('noise/rnnoise-worklet.js', document.baseURI),
        );
        await context.resume();
        source = context.createMediaStreamSource(rawStream);
        processor = new AudioWorkletNode(context, 'boomroom-rnnoise', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        const destination = context.createMediaStreamDestination();
        source.connect(processor);
        processor.connect(destination);
        return { stream: destination.stream, source, processor, destination, context };
      } catch (error) {
        source?.disconnect();
        processor?.disconnect();
        await context.close().catch(() => {});
        throw error;
      }
    },
    async dispose(session) {
      try { session.processor.port.postMessage('dispose'); } catch (_) {}
      try { session.source.disconnect(); } catch (_) {}
      try { session.processor.disconnect(); } catch (_) {}
      try { session.destination.disconnect(); } catch (_) {}
      if (session.context.state !== 'closed') await session.context.close();
    },
  };
})();
