export function calculateRmsAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  const sumOfSquares = samples.reduce(
    (currentSumOfSquares, audioSample) => currentSumOfSquares + audioSample * audioSample,
    0,
  );

  return Math.sqrt(sumOfSquares / samples.length);
}
