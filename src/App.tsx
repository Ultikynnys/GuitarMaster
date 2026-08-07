import { useAudioInput } from "./useAudioInput";
import ChordGame from "./ChordGame";
import QuickTuner from "./QuickTuner";

function ConfidenceRing({ value }: { value: number }) {
  return (
    <div className="confidence">
      <span>{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function App() {
  const audio = useAudioInput();
  const cents = audio.pitch?.cents ?? 0;

  return (
    <main>
      <section className="hero">
        <div className="app-introduction">
          <h1>GuitarMaster</h1>
          <p className="how-to-title">How to use</p>
          <ol className="usage-steps">
            <li><span>01</span>Connect the guitar to an audio interface or line input.</li>
            <li><span>02</span>Allow microphone access and select that input.</li>
            <li><span>03</span>Enable the input, then play a note or chord.</li>
            <li><span>04</span>Use the chord trainer to practice progressions.</li>
          </ol>
        </div>

        <aside className="input-panel">
          <div className="input-panel-heading">
            <strong>Audio input</strong>
            <span className={`status status-${audio.status}`}>
              <i /> {audio.status === "listening" ? "Input live" : audio.status}
            </span>
          </div>

          {!audio.hasPermission ? (
            <div className="permission-request">
              <p>Enable the guitar input to grant microphone access and list available devices.</p>
              <button onClick={() => void audio.start()} disabled={audio.status === "requesting"}>
                {audio.status === "requesting" ? "Opening input..." : "Enable guitar input"}
              </button>
            </div>
          ) : (
            <>
              <label htmlFor="audio-input">Available inputs</label>
              <select
                id="audio-input"
                value={audio.selectedDeviceId}
                onChange={(event) => audio.selectDevice(event.target.value)}
                disabled={audio.status === "requesting"}
              >
                <option value="">Default audio input</option>
                {audio.devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Audio input ${index + 1}`}
                  </option>
                ))}
              </select>
              <div className="device-meta">
                <span>{audio.devices.length} input{audio.devices.length === 1 ? "" : "s"} found</span>
                <button
                  className="scan-button"
                  onClick={() => void audio.scanDevices()}
                  disabled={audio.status === "requesting" || audio.status === "listening"}
                >
                  Refresh inputs
                </button>
              </div>
              {audio.status === "listening" ? (
                <button className="secondary input-action" onClick={audio.stop}>Stop listening</button>
              ) : (
                <button className="input-action" onClick={() => void audio.start()} disabled={audio.status === "requesting"}>
                  {audio.status === "requesting" ? "Opening input..." : "Enable guitar input"}
                </button>
              )}
            </>
          )}
          {audio.hasPermission && <div className="monitor-controls">
            <div className="monitor-heading">
              <div>
                <strong>Pass through</strong>
                <span>Hear the input through this device</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={audio.passThrough}
                  onChange={(event) => audio.setPassThrough(event.target.checked)}
                  disabled={audio.status !== "listening"}
                />
                <i />
              </label>
            </div>
            <label className="volume-control" htmlFor="monitor-volume">
              <span>Monitor volume</span>
              <output>{Math.round(audio.passThroughVolume * 100)}%</output>
            </label>
            <input
              id="monitor-volume"
              className="volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audio.passThroughVolume}
              onChange={(event) => audio.setPassThroughVolume(Number(event.target.value))}
              disabled={!audio.passThrough || audio.status !== "listening"}
            />
            {audio.passThrough && <p className="feedback-warning">Use headphones to prevent speaker feedback.</p>}
          </div>}
          <div className="monitor-controls">
            <div className="monitor-heading">
              <div>
                <strong>Level input</strong>
                <span>Compress quiet and loud playing toward a steady level</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={audio.compressorEnabled}
                  onChange={(event) => audio.setCompressorEnabled(event.target.checked)}
                  disabled={audio.status !== "listening"}
                />
                <i />
              </label>
            </div>
            <label className="volume-control" htmlFor="compressor-amount">
              <span>Compression</span>
              <output>{Math.round(audio.compressorAmount * 100)}%</output>
            </label>
            <input
              id="compressor-amount"
              className="volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audio.compressorAmount}
              onChange={(event) => audio.setCompressorAmount(Number(event.target.value))}
              disabled={!audio.compressorEnabled || audio.status !== "listening"}
            />
          </div>
          {audio.error && <p className="error" role="alert">{audio.error}</p>}
        </aside>
      </section>

      <section className={`analyzer ${audio.status !== "listening" ? "inactive" : ""}`} aria-live="polite">
        <article className="readout chord-readout">
          <div className="readout-title"><span>01</span> Chord</div>
          <div className="primary-value">{audio.chord?.name ?? "--"}</div>
          <div className="chord-notes">
            {audio.chord?.notes.map((note) => <span key={note}>{note}</span>) ?? <p>Play a clean, sustained chord</p>}
          </div>
          {audio.chord && <ConfidenceRing value={audio.chord.confidence} />}
        </article>

        <article className="readout note-readout">
          <div className="readout-title"><span>02</span> Strongest note</div>
          <div className="note-value">
            <strong>{audio.pitch?.note ?? "--"}</strong>
            <sup>{audio.pitch?.octave ?? ""}</sup>
          </div>
          <p className="frequency">{audio.pitch ? `${audio.pitch.frequency.toFixed(1)} Hz` : "Waiting for signal"}</p>
          <div className="tuner">
            <div className="tuner-scale"><span>-50</span><span>IN TUNE</span><span>+50</span></div>
            <div className="tuner-track">
              <i style={{ left: `${Math.max(0, Math.min(100, cents + 50))}%` }} />
            </div>
            <p>{audio.pitch ? `${cents > 0 ? "+" : ""}${cents} cents` : "--"}</p>
          </div>
        </article>

        <article className="readout signal-readout">
          <div className="readout-title"><span>03</span> Signal</div>
          <div className="level-bars" aria-label={`Input level ${Math.round(audio.level * 100)} percent`}>
            {Array.from({ length: 18 }, (_, index) => (
              <i key={index} className={index / 18 < audio.level ? "lit" : ""} />
            ))}
          </div>
          <strong>{Math.round(audio.level * 100)}%</strong>
          <p>Aim for a steady level without clipping. Browser processing stays entirely on this device.</p>
        </article>
      </section>

      <QuickTuner pitch={audio.pitch} listening={audio.status === "listening"} />

      <ChordGame detectedChord={audio.chord} detectedPitch={audio.pitch} listening={audio.status === "listening"} inputLevel={audio.level} attackCount={audio.attackCount} />

      <footer>
        <span>v{__APP_VERSION__}</span>
      </footer>
    </main>
  );
}
