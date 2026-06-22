export function AudioWaveform() {
  return (
    <div className="audio-waveform" aria-label="Listening">
      {[0, 1, 2, 3, 4].map((waveformBarIndex) => (
        <span key={waveformBarIndex} style={{ animationDelay: `${waveformBarIndex * 80}ms` }} />
      ))}
    </div>
  );
}
