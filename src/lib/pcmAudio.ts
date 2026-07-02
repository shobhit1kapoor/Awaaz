export function downsampleFloat32To16Khz(
  audioSamples: Float32Array,
  sourceSampleRate: number,
): Float32Array {
  const targetSampleRate = 16_000;
  if (sourceSampleRate === targetSampleRate) {
    return audioSamples;
  }
  if (sourceSampleRate < targetSampleRate) {
    throw new Error("Source sample rate must be at least 16000 Hz.");
  }

  const sampleRateRatio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(audioSamples.length / sampleRateRatio);
  const outputSamples = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourceStart = Math.floor(outputIndex * sampleRateRatio);
    const sourceEnd = Math.min(
      Math.floor((outputIndex + 1) * sampleRateRatio),
      audioSamples.length,
    );
    let sampleSum = 0;
    let sampleCount = 0;
    for (
      let sourceIndex = sourceStart;
      sourceIndex < sourceEnd;
      sourceIndex += 1
    ) {
      sampleSum += audioSamples[sourceIndex];
      sampleCount += 1;
    }
    outputSamples[outputIndex] =
      sampleCount === 0 ? audioSamples[sourceStart] : sampleSum / sampleCount;
  }

  return outputSamples;
}

export function encodeFloat32AsPcm16(audioSamples: Float32Array): ArrayBuffer {
  const pcmBuffer = new ArrayBuffer(audioSamples.length * 2);
  const pcmView = new DataView(pcmBuffer);

  for (
    let sampleIndex = 0;
    sampleIndex < audioSamples.length;
    sampleIndex += 1
  ) {
    const clampedSample = Math.max(-1, Math.min(1, audioSamples[sampleIndex]));
    const pcmSample =
      clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff;
    pcmView.setInt16(sampleIndex * 2, pcmSample, true);
  }

  return pcmBuffer;
}
