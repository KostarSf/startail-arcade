import { useState } from "react";
import { useAudioSettings } from "./audio/audio-settings";
import type { SoundCategory } from "./audio/audio-engine";
import { clientEngine } from "./engine";

export function AudioSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useAudioSettings();

  const handleMasterVolumeChange = (volume: number) => {
    settings.setMasterVolume(volume);
    // Sync with audio engine
    clientEngine.syncAudioSettings();
  };

  const handleVolumeChange = (category: SoundCategory, volume: number) => {
    settings.setVolume(category, volume);
    // Sync with audio engine
    clientEngine.syncAudioSettings();
  };

  const handleMuteToggle = (category: SoundCategory) => {
    clientEngine.playUIClick();
    const newMuted = !settings.mutes[category];
    settings.setMuted(category, newMuted);
    // Sync with audio engine
    clientEngine.syncAudioSettings();
  };

  return (
    <div className="relative pointer-events-auto">
      <button
        onClick={() => {
          clientEngine.playUIClick();
          setIsOpen(!isOpen);
        }}
        onMouseEnter={() => clientEngine.playUIHover()}
        className="settings-button"
        aria-label="Audio Settings"
      >
        🔊
      </button>
      {isOpen && (
        <div className="audio-settings-panel">
          <div className="audio-settings-header">AUDIO SETTINGS</div>
          {/* Master Volume Control */}
          <div className="audio-setting-item">
            <div className="audio-setting-label">
              <span>MASTER</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.masterVolume}
              onChange={(e) =>
                handleMasterVolumeChange(parseFloat(e.target.value))
              }
              className="audio-volume-slider"
            />
            <span className="audio-volume-value">
              {Math.round(settings.masterVolume * 100)}%
            </span>
          </div>
          {/* Category Volume Controls */}
          {(["game", "ui", "music", "ambience"] as SoundCategory[]).map((category) => (
            <div key={category} className="audio-setting-item">
              <div className="audio-setting-label">
                <span>{category.toUpperCase()}</span>
                <button
                  onClick={() => handleMuteToggle(category)}
                  onMouseEnter={() => clientEngine.playUIHover()}
                  className={`audio-mute-button ${settings.mutes[category] ? "muted" : ""}`}
                >
                  {settings.mutes[category] ? "🔇" : "🔊"}
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.volumes[category]}
                onChange={(e) =>
                  handleVolumeChange(category, parseFloat(e.target.value))
                }
                disabled={settings.mutes[category]}
                className="audio-volume-slider"
              />
              <span className="audio-volume-value">
                {Math.round(settings.volumes[category] * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
