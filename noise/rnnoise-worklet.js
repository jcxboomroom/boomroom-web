import createRnnoiseModule from './rnnoise-sync.js';

const FRAME_SIZE = 480;
const SCALE = 32768;

class BoomRoomRnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const wasm = createRnnoiseModule();
    this.wasm = wasm;
    this.inputPointer = wasm._malloc(FRAME_SIZE * 4);
    this.inputOffset = this.inputPointer >> 2;
    this.context = wasm._rnnoise_create();
    this.frame = new Float32Array(FRAME_SIZE);
    this.frameUsed = 0;
    // Enough room for one RNNoise frame plus the next 128-sample worklet block.
    this.output = new Float32Array(2048);
    this.read = 0;
    this.write = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') {
        wasm._rnnoise_destroy(this.context);
        wasm._free(this.inputPointer);
        this.context = 0;
      }
    };
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0];
    const outputChannels = outputs[0];
    if (!outputChannels || outputChannels.length === 0) return true;
    const length = outputChannels[0].length;
    const mono = inputChannels?.[0];

    for (let i = 0; i < length; i++) {
      const sample = mono && i < mono.length ? mono[i] : 0;
      this.frame[this.frameUsed++] = sample;
      if (this.frameUsed === FRAME_SIZE) {
        for (let j = 0; j < FRAME_SIZE; j++) {
          this.wasm.HEAPF32[this.inputOffset + j] = this.frame[j] * SCALE;
        }
        this.wasm._rnnoise_process_frame(this.context, this.inputPointer, this.inputPointer);
        for (let j = 0; j < FRAME_SIZE; j++) {
          this.output[this.write] = this.wasm.HEAPF32[this.inputOffset + j] / SCALE;
          this.write = (this.write + 1) % this.output.length;
        }
        this.frameUsed = 0;
      }

      const out = this.read === this.write ? 0 : this.output[this.read];
      if (this.read !== this.write) this.read = (this.read + 1) % this.output.length;
      for (const channel of outputChannels) channel[i] = out;
    }
    return true;
  }
}

registerProcessor('boomroom-rnnoise', BoomRoomRnnoiseProcessor);
